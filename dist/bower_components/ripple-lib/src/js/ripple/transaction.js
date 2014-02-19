//
// Transactions
//
//  Construction:
//    remote.transaction()  // Build a transaction object.
//     .offer_create(...)   // Set major parameters.
//     .set_flags()         // Set optional parameters.
//     .on()                // Register for events.
//     .submit();           // Send to network.
//
//  Events:
// 'success' : Transaction submitted without error.
// 'error' : Error submitting transaction.
// 'proposed' : Advisory proposed status transaction.
// - A client should expect 0 to multiple results.
// - Might not get back. The remote might just forward the transaction.
// - A success could be reverted in final.
// - local error: other remotes might like it.
// - malformed error: local server thought it was malformed.
// - The client should only trust this when talking to a trusted server.
// 'final' : Final status of transaction.
// - Only expect a final from dishonest servers after a tesSUCCESS or ter*.
// 'lost' : Gave up looking for on ledger_closed.
// 'pending' : Transaction was not found on ledger_closed.
// 'state' : Follow the state of a transaction.
//    'client_submitted'     - Sent to remote
//     |- 'remoteError'      - Remote rejected transaction.
//      \- 'client_proposed' - Remote provisionally accepted transaction.
//       |- 'client_missing' - Transaction has not appeared in ledger as expected.
//       | |\- 'client_lost' - No longer monitoring missing transaction.
//       |/
//       |- 'tesSUCCESS'     - Transaction in ledger as expected.
//       |- 'ter...'         - Transaction failed.
//       \- 'tec...'         - Transaction claimed fee only.
//
// Notes:
// - All transactions including those with local and malformed errors may be
//   forwarded anyway.
// - A malicous server can:
//   - give any proposed result.
//     - it may declare something correct as incorrect or something correct as incorrect.
//     - it may not communicate with the rest of the network.
//   - may or may not forward.
//

var EventEmitter     = require('events').EventEmitter;
var util             = require('util');

var sjcl             = require('../../../build/sjcl');

var Amount           = require('./amount').Amount;
var Currency         = require('./amount').Currency;
var UInt160          = require('./amount').UInt160;
var Seed             = require('./seed').Seed;
var SerializedObject = require('./serializedobject').SerializedObject;

var config           = require('./config');

var SUBMIT_MISSING  = 4;    // Report missing.
var SUBMIT_LOST     = 8;    // Give up tracking.

// A class to implement transactions.
// - Collects parameters
// - Allow event listeners to be attached to determine the outcome.
var Transaction = function (remote) {
  EventEmitter.call(this);

  // YYY Make private as many variables as possible.
  var self  = this;

  this.callback     = undefined;
  this.remote       = remote;
  this._secret      = undefined;
  this._build_path  = false;

  // Transaction data.
  this.tx_json = {
    'Flags' : 0, // XXX Would be nice if server did not require this.
  };

  this.hash         = undefined;
  this.submit_index = undefined;        // ledger_current_index was this when transaction was submited.
  this.state        = undefined;        // Under construction.
  this.finalized    = false;

  this.on('success', function (message) {
    if (message.engine_result) {
      self.hash       = message.tx_json.hash;

      self.set_state('client_proposed');

      self.emit('proposed', {
        'tx_json'         : message.tx_json,
        'result'          : message.engine_result,
        'result_code'     : message.engine_result_code,
        'result_message'  : message.engine_result_message,
        'rejected'        : self.isRejected(message.engine_result_code),      // If server is honest, don't expect a final if rejected.
      });
    }
  });

  this.on('error', function (message) {
    // Might want to give more detailed information.
    self.set_state('remoteError');
  });
};

util.inherits(Transaction, EventEmitter);

// XXX This needs to be determined from the network.
Transaction.fee_units = {
  'default'         : 10,
};

Transaction.flags = {
  'AccountSet' : {
    'RequireDestTag'          : 0x00010000,
    'OptionalDestTag'         : 0x00020000,
    'RequireAuth'             : 0x00040000,
    'OptionalAuth'            : 0x00080000,
    'DisallowXRP'             : 0x00100000,
    'AllowXRP'                : 0x00200000,
  },

  'OfferCreate' : {
    'Passive'                 : 0x00010000,
    'ImmediateOrCancel'       : 0x00020000,
    'FillOrKill'              : 0x00040000,
    'Sell'                    : 0x00080000,
  },

  'Payment' : {
    'NoRippleDirect'          : 0x00010000,
    'PartialPayment'          : 0x00020000,
    'LimitQuality'            : 0x00040000,
  },
};

Transaction.formats = require('./binformat').tx;

Transaction.HASH_SIGN         = 0x53545800;
Transaction.HASH_SIGN_TESTNET = 0x73747800;

Transaction.prototype.consts = {
  'telLOCAL_ERROR'  : -399,
  'temMALFORMED'    : -299,
  'tefFAILURE'      : -199,
  'terRETRY'        : -99,
  'tesSUCCESS'      : 0,
  'tecCLAIMED'      : 100,
};

Transaction.prototype.isTelLocal = function (ter) {
  return ter >= this.consts.telLOCAL_ERROR && ter < this.consts.temMALFORMED;
};

Transaction.prototype.isTemMalformed = function (ter) {
  return ter >= this.consts.temMALFORMED && ter < this.consts.tefFAILURE;
};

Transaction.prototype.isTefFailure = function (ter) {
  return ter >= this.consts.tefFAILURE && ter < this.consts.terRETRY;
};

Transaction.prototype.isTerRetry = function (ter) {
  return ter >= this.consts.terRETRY && ter < this.consts.tesSUCCESS;
};

Transaction.prototype.isTepSuccess = function (ter) {
  return ter >= this.consts.tesSUCCESS;
};

Transaction.prototype.isTecClaimed = function (ter) {
  return ter >= this.consts.tecCLAIMED;
};

Transaction.prototype.isRejected = function (ter) {
  return this.isTelLocal(ter) || this.isTemMalformed(ter) || this.isTefFailure(ter);
};

Transaction.prototype.set_state = function (state) {
  if (this.state !== state) {
    this.state  = state;
    this.emit('state', state);
  }
};

/**
 * Attempts to complete the transaction for submission.
 *
 * This function seeks to fill out certain fields, such as Fee and
 * SigningPubKey, which can be determined by the library based on network
 * information and other fields.
 */
Transaction.prototype.complete = function () {
  var tx_json = this.tx_json;

  if ("undefined" === typeof tx_json.Fee && this.remote.local_fee) {
    this.tx_json.Fee = this.remote.fee_tx(this.fee_units()).to_json();
  }

  if ("undefined" === typeof tx_json.SigningPubKey && (!this.remote || this.remote.local_signing)) {
    var seed = Seed.from_json(this._secret);
    var key = seed.get_key(this.tx_json.Account);
    tx_json.SigningPubKey = key.to_hex_pub();
  }

  return this.tx_json;
};

Transaction.prototype.serialize = function () {
  return SerializedObject.from_json(this.tx_json);
};

Transaction.prototype.signing_hash = function () {
  var prefix = config.testnet
    ? Transaction.HASH_SIGN_TESTNET
    : Transaction.HASH_SIGN;

  return SerializedObject.from_json(this.tx_json).signing_hash(prefix);
};

Transaction.prototype.sign = function () {
  var seed = Seed.from_json(this._secret);
  var hash = this.signing_hash();
  var key  = seed.get_key(this.tx_json.Account);
  var sig  = key.sign(hash, 0);
  var hex  = sjcl.codec.hex.fromBits(sig).toUpperCase();

  this.tx_json.TxnSignature = hex;
};

Transaction.prototype._hasTransactionListeners = function() {
  return this.listeners('final').length
      || this.listeners('lost').length
      || this.listeners('pending').length
};

// Submit a transaction to the network.
// XXX Don't allow a submit without knowing ledger_index.
// XXX Have a network canSubmit(), post events for following.
// XXX Also give broader status for tracking through network disconnects.
// callback = function (status, info) {
//   // status is final status.  Only works under a ledger_accepting conditions.
//   switch status:
//    case 'tesSUCCESS': all is well.
//    case 'tejSecretUnknown': unable to sign transaction - secret unknown
//    case 'tejServerUntrusted': sending secret to untrusted server.
//    case 'tejInvalidAccount': locally detected error.
//    case 'tejLost': locally gave up looking
//    default: some other TER
// }

Transaction.prototype.submit = function (callback) {
  var self    = this;
  var tx_json = this.tx_json;

  this.callback = typeof callback === 'function'
    ? callback
    : function(){};

  function finish(err) {
    self.emit('error', err);
    self.callback('error', err);
  }

  if (typeof tx_json.Account !== 'string') {
    finish({
      'error' :          'tejInvalidAccount',
      'error_message' :  'Bad account.'
    });
    return this;
  }

  // YYY Might check paths for invalid accounts.

  this.complete();

    //console.log('Callback or has listeners');

  // There are listeners for callback, 'final', 'lost', or 'pending' arrange to emit them.

  this.submit_index = this.remote._ledger_current_index;

  // When a ledger closes, look for the result.
  function on_ledger_closed(message) {
    if (self.finalized) return;

    var ledger_hash   = message.ledger_hash;
    var ledger_index  = message.ledger_index;
    var stop          = false;

    // XXX make sure self.hash is available.
    var transaction_entry = self.remote.request_transaction_entry(self.hash)

    transaction_entry.ledger_hash(ledger_hash)

    transaction_entry.on('success', function (message) {
      if (self.finalized) return;
      self.set_state(message.metadata.TransactionResult);
      self.remote.removeListener('ledger_closed', on_ledger_closed);
      self.emit('final', message);
      self.finalized = true;
      self.callback(message.metadata.TransactionResult, message);
    });

    transaction_entry.on('error', function (message) {
      if (self.finalized) return;

      if (message.error === 'remoteError' && message.remote.error === 'transactionNotFound') {
        if (self.submit_index + SUBMIT_LOST < ledger_index) {
          self.set_state('client_lost');        // Gave up.
          self.emit('lost');
          self.callback('tejLost', message);
          self.remote.removeListener('ledger_closed', on_ledger_closed);
          self.emit('final', message);
          self.finalized = true;
        } else if (self.submit_index + SUBMIT_MISSING < ledger_index) {
          self.set_state('client_missing');    // We don't know what happened to transaction, still might find.
          self.emit('pending');
        } else {
          self.emit('pending');
        }
      }
      // XXX Could log other unexpectedness.
    });

    transaction_entry.request();
  };

  this.remote.on('ledger_closed', on_ledger_closed);

  this.once('error', function (message) {
    self.callback(message.error, message);
  });

  this.set_state('client_submitted');

  if (self.remote.local_sequence && !self.tx_json.Sequence) {
    
    self.tx_json.Sequence = this.remote.account_seq(self.tx_json.Account, 'ADVANCE');
    // console.log("Sequence: %s", self.tx_json.Sequence);

    if (!self.tx_json.Sequence) {
      //console.log('NO SEQUENCE');

      // Look in the last closed ledger.
      var account_seq = this.remote.account_seq_cache(self.tx_json.Account, false)

      account_seq.on('success_account_seq_cache', function () {
        // Try again.
        self.submit();
      })

      account_seq.on('error_account_seq_cache', function (message) {
        // XXX Maybe be smarter about this. Don't want to trust an untrusted server for this seq number.
        // Look in the current ledger.
        self.remote.account_seq_cache(self.tx_json.Account, 'CURRENT')
        .on('success_account_seq_cache', function () {
          // Try again.
          self.submit();
        })
        .on('error_account_seq_cache', function (message) {
          // Forward errors.
          self.emit('error', message);
        })
        .request();
      })

      account_seq.request();

      return this;
    }

    // If the transaction fails we want to either undo incrementing the sequence
    // or submit a noop transaction to consume the sequence remotely.
    this.once('success', function (res) {
      if (typeof res.engine_result === 'string') {
        switch (res.engine_result.slice(0, 3)) {
          // Synchronous local error
          case 'tej':
            self.remote.account_seq(self.tx_json.Account, 'REWIND');
            break;

          case 'ter':
            // XXX: What do we do in case of ter?
            break;

          case 'tel':
          case 'tem':
          case 'tef':
            // XXX Once we have a transaction submission manager class, we can
            //     check if there are any other transactions pending. If there are,
            //     we should submit a dummy transaction to ensure those
            //     transactions are still valid.
            //var noop = self.remote.transaction().account_set(self.tx_json.Account);
            //noop.submit();

            // XXX Hotfix. This only works if no other transactions are pending.
            self.remote.account_seq(self.tx_json.Account, 'REWIND');
            break;
        }
      }
    });
  }

  // Prepare request
  var request = this.remote.request_submit();

  // Forward events
  request.emit = this.emit.bind(this);

  if (!this._secret && !this.tx_json.Signature) {
    finish({
      'result'          : 'tejSecretUnknown',
      'result_message'  : "Could not sign transactions because we."
    });
    return this;
  } else if (this.remote.local_signing) {
    this.sign();
    request.tx_blob(this.serialize().to_hex());
  } else {
    if (!this.remote.trusted) {
      finish({
        'result'          : 'tejServerUntrusted',
        'result_message'  : "Attempt to give a secret to an untrusted server."
      });
    }

    request.secret(this._secret);
    request.build_path(this._build_path);
    request.tx_json(this.tx_json);
  }

  request.request();

  return this;
}

//
// Set options for Transactions
//

// --> build: true, to have server blindly construct a path.
//
// "blindly" because the sender has no idea of the actual cost except that is must be less than send max.
Transaction.prototype.build_path = function (build) {
  this._build_path = build;

  return this;
}

// tag should be undefined or a 32 bit integer.   
// YYY Add range checking for tag.
Transaction.prototype.destination_tag = function (tag) {
  if (tag !== undefined) {
    this.tx_json.DestinationTag = tag;
  }

  return this;
}

Transaction._path_rewrite = function (path) {
  var path_new  = [];

  for (var i = 0, l = path.length; i < l; i++) {
    var node      = path[i];
    var node_new  = {};

    if ('account' in node)
      node_new.account  = UInt160.json_rewrite(node.account);

    if ('issuer' in node)
      node_new.issuer   = UInt160.json_rewrite(node.issuer);

    if ('currency' in node)
      node_new.currency = Currency.json_rewrite(node.currency);

    path_new.push(node_new);
  }

  return path_new;
}

Transaction.prototype.path_add = function (path) {
  this.tx_json.Paths  = this.tx_json.Paths || [];
  this.tx_json.Paths.push(Transaction._path_rewrite(path));

  return this;
}

// --> paths: undefined or array of path
// A path is an array of objects containing some combination of: account, currency, issuer
Transaction.prototype.paths = function (paths) {
  for (var i = 0, l = paths.length; i < l; i++) {
    this.path_add(paths[i]);
  }

  return this;
}

// If the secret is in the config object, it does not need to be provided.
Transaction.prototype.secret = function (secret) {
  this._secret = secret;
}

Transaction.prototype.send_max = function (send_max) {
  if (send_max) {
    this.tx_json.SendMax = Amount.json_rewrite(send_max);
  }

  return this;
}

// tag should be undefined or a 32 bit integer.   
// YYY Add range checking for tag.
Transaction.prototype.source_tag = function (tag) {
  if (tag) {
    this.tx_json.SourceTag = tag;
  }

  return this;
}

// --> rate: In billionths.
Transaction.prototype.transfer_rate = function (rate) {
  this.tx_json.TransferRate = Number(rate);

  if (this.tx_json.TransferRate < 1e9) {
    throw new Error('invalidTransferRate');
  }

  return this;
}

// Add flags to a transaction.
// --> flags: undefined, _flag_, or [ _flags_ ]
Transaction.prototype.set_flags = function (flags) {
  if (flags) {
    var transaction_flags = Transaction.flags[this.tx_json.TransactionType];

    // We plan to not define this field on new Transaction.
    if (this.tx_json.Flags === undefined) {
      this.tx_json.Flags = 0;
    }

    var flag_set = Array.isArray(flags) ? flags : [ flags ];

    for (var index in flag_set) {
      if (!flag_set.hasOwnProperty(index)) continue;

      var flag = flag_set[index];

      if (flag in transaction_flags) {
        this.tx_json.Flags += transaction_flags[flag];
      } else {
        // XXX Immediately report an error or mark it.
      }
    }
  }

  return this;
}

//
// Transactions
//

Transaction.prototype._account_secret = function (account) {
  // Fill in secret from remote, if available.
  return this.remote.secrets[account];
};

// Options:
//  .domain()           NYI
//  .flags()
//  .message_key()      NYI
//  .transfer_rate()
//  .wallet_locator()   NYI
//  .wallet_size()      NYI
Transaction.prototype.account_set = function (src) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'AccountSet';
  this.tx_json.Account          = UInt160.json_rewrite(src);

  return this;
};

Transaction.prototype.claim = function (src, generator, public_key, signature) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'Claim';
  this.tx_json.Generator        = generator;
  this.tx_json.PublicKey        = public_key;
  this.tx_json.Signature        = signature;

  return this;
};

Transaction.prototype.offer_cancel = function (src, sequence) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'OfferCancel';
  this.tx_json.Account          = UInt160.json_rewrite(src);
  this.tx_json.OfferSequence    = Number(sequence);

  return this;
};

// Options:
//  .set_flags()
// --> expiration : if not undefined, Date or Number
// --> cancel_sequence : if not undefined, Sequence
Transaction.prototype.offer_create = function (src, taker_pays, taker_gets, expiration, cancel_sequence) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'OfferCreate';
  this.tx_json.Account          = UInt160.json_rewrite(src);
  this.tx_json.TakerPays        = Amount.json_rewrite(taker_pays);
  this.tx_json.TakerGets        = Amount.json_rewrite(taker_gets);

  if (expiration) {
    this.tx_json.Expiration = expiration instanceof Date
    ? expiration.getTime()
    : Number(expiration);
  }

  if (cancel_sequence) {
    this.tx_json.OfferSequence = Number(cancel_sequence);
  }

  return this;
};

Transaction.prototype.password_fund = function (src, dst) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'PasswordFund';
  this.tx_json.Destination      = UInt160.json_rewrite(dst);

  return this;
}

Transaction.prototype.password_set = function (src, authorized_key, generator, public_key, signature) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'PasswordSet';
  this.tx_json.RegularKey       = authorized_key;
  this.tx_json.Generator        = generator;
  this.tx_json.PublicKey        = public_key;
  this.tx_json.Signature        = signature;

  return this;
}

// Construct a 'payment' transaction.
//
// When a transaction is submitted:
// - If the connection is reliable and the server is not merely forwarding and is not malicious,
// --> src : UInt160 or String
// --> dst : UInt160 or String
// --> deliver_amount : Amount or String.
//
// Options:
//  .paths()
//  .build_path()
//  .destination_tag()
//  .path_add()
//  .secret()
//  .send_max()
//  .set_flags()
//  .source_tag()
Transaction.prototype.payment = function (src, dst, deliver_amount) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'Payment';
  this.tx_json.Account          = UInt160.json_rewrite(src);
  this.tx_json.Amount           = Amount.json_rewrite(deliver_amount);
  this.tx_json.Destination      = UInt160.json_rewrite(dst);

  return this;
}

Transaction.prototype.ripple_line_set = function (src, limit, quality_in, quality_out) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'TrustSet';
  this.tx_json.Account          = UInt160.json_rewrite(src);

  // Allow limit of 0 through.
  if (limit !== undefined)
    this.tx_json.LimitAmount  = Amount.json_rewrite(limit);

  if (quality_in)
    this.tx_json.QualityIn    = quality_in;

  if (quality_out)
    this.tx_json.QualityOut   = quality_out;

  // XXX Throw an error if nothing is set.

  return this;
};

Transaction.prototype.wallet_add = function (src, amount, authorized_key, public_key, signature) {
  this._secret                  = this._account_secret(src);
  this.tx_json.TransactionType  = 'WalletAdd';
  this.tx_json.Amount           = Amount.json_rewrite(amount);
  this.tx_json.RegularKey       = authorized_key;
  this.tx_json.PublicKey        = public_key;
  this.tx_json.Signature        = signature;

  return this;
};

/**
 * Returns the number of fee units this transaction will cost.
 *
 * Each Ripple transaction based on its type and makeup costs a certain number
 * of fee units. The fee units are calculated on a per-server basis based on the
 * current load on both the network and the server.
 *
 * @see https://ripple.com/wiki/Transaction_Fee
 *
 * @return {Number} Number of fee units for this transaction.
 */
Transaction.prototype.fee_units = function ()
{
  return Transaction.fee_units["default"];
};

exports.Transaction     = Transaction;

// vim:sw=2:sts=2:ts=8:et
