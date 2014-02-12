rippleApp.factory('RippleRemote', function($rootScope){
	return {
		init: function(){
			$rootScope.connected = false;

			//Conection status
			$rootScope.$on('CONNECTED', function(){
		        $rootScope.connected = true;
		    });

		    $rootScope.$on('CONNECTING', function(){
		        $rootScope.connecting = true;
		    });

			//Conection status
		    $rootScope.$on('DISCONNECTED', function(){
		        $rootScope.connected = false;
		    });
		    

		    $rootScope.currencyTypes = {
				BTC: {
					amount: 0,
					currency: "BTC"
				},
				CNY: {
					amount: 0,
					currency: "CNY"
				},
				USD: {
					amount: 0,
					currency: "USD"
				},
				AUD: {
					amount: 0,
					currency: "AUD"
				},
				XRP: {
					amount: 0,
					currency: "XRP"
				},
				CAD: {
					amount: 0,
					currency: "CAD"
				},
				EUR: {
					amount: 0,
					currency: "EUR"
				},
				other: {
					amount: 0,
					currency: "other"
				}
			};

		    var Remote = ripple.Remote;
		    this.remote = new Remote({
				trace: false,
				trusted: true,
				local_signing: true,
				connection_offest: 60,
				servers: [{ 
					host: 's1.ripple.com',
					port: 443, 
					secure: true, 
					pool: 3
				}]
			});
			
		},
		on: function(eventName, callback){
			var that = this;
			this.remote.connect(function(){
				that.remote.on(eventName, callback);
			});
		}
	}
});