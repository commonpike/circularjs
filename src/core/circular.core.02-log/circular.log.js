/* ----------------------
	log
----------------------- */

new CircularModule('log',{

	config				: {
		debug	: false,
	},
	
	settings 			: {
	
	},
		
	attributes		: {
		'cc-log' : {
			in	: function(ccattr,ccnode,node) {
				this.write('@log',ccattr.content.value);
			}
		}
	},
	
	init	: function() {
		if (this.config.debug) {
			this.toggleDebug(true);
		}
	},
	
	// -------------
	
	// read once from config;
	// set by toggleDebug otherwise
	debugging		: false,
	
	toggleDebug: function(state) 	{ 
		if (state===undefined) state = !this.debugging;
		if (!state) this.write('@log','debug off');
		this.debugging=state; 
		if (state) this.write('@log','debug on');
	},
	
	tron	: function() {
		this.toggleDebug(true);
	}, 
	
	troff : function() {
		this.toggleDebug(false);
	},
	
	debug	: function() {
		if (this.debugging) {
			if (Circular.engine) {
				arguments = Array.prototype.concat.apply([Circular.engine.counter], arguments);
			}
			this.write(arguments);
		}
	},
	
	write		: function() {
		console.log.apply(console,arguments);
	},
	info	: function() {
		console.info.apply(console,arguments);
	},
	warn	: function() {
		console.warn.apply(console,arguments);
	},
	error	: function() {
		console.error.apply(console,arguments);
	},
	fatal:	function() {
		console.error.apply(console,arguments);
		Circular.die();
	}
});