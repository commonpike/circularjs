

/* ----------------------
	parser
----------------------- */

new CircularModule({
	
	name			: 'parser',
	requires	: ['log'],
	config		: {
		// exprregex		:	/{{([^}]*?)}}/g,
		// exprregex		:	/{({|\[)([^}\]]*?)(}|\])}/g,
		// exprregex 		: /{({|\[)(.*?(?=[}\]]}))(}|\])}/g,
		// exprregex		: /{[{\[]([\s\S]*?(?=[}\]]}))[}\]]+}/g,
		exprregex				: /{{([\s\S]*?(?=}}))}}/g,
		flagregex				: /\|[pew]+$/,
		evalfail				: undefined,
		rootscope				: 'window' // bad idea
	},
	
	// requires esprima.
	// @see http://esprima.org/demo/parse.html
	
	
	getPaths :	function(expression) {
		Circular.log.debug('Circular.parser.getPaths',expression);
		var ast = null;
		try {
			ast = esprima.parse(expression);
		} catch (e) {
			// thats not valid javascript. perhaps its an object def
			try {
        ast = esprima.parse('var foo='+expression);
    	} catch (e) {
        // its not json either
        Circular.log.error('Circular.parser.getPaths',expression,'not ecmascript, not an object def');
        return false;
    	}
		}
		
		if (ast) {
			Circular.log.debug('Circular.parser.getPaths',ast);
			var paths = new Array();
			this.recursePaths(ast,paths);
			return paths;
		} else return false;
	},
	
	recursePaths	: function(tree,paths,path) {
	
		Circular.log.debug('Circular.parser.recursePaths',paths,path);
		
		if (!tree || !paths) return false;
		if (tree.type =='Identifier') {

			// some sort of global
			Circular.log.debug('Circular.parser.recursePaths','adding identifier '+tree.name);
			paths.push(Circular.config.rootscope+'.'+tree.name);

		} else if (tree.type=="ThisExpression") {
		
			// ignore any subpaths of 'this'
			paths.push('this');
			
		} else if (tree.type =='MemberExpression') {
		
			// member expression
			
			
			if (tree.property.type=='Identifier' || tree.property.type=='Literal') {
			
				// like foo[bar][24].quz ; the property is 'quz'
				// dabble down the object to get the path
				
				if (tree.property.type=='Identifier') {
					path = (path)?'.'+tree.property.name+path:'.'+tree.property.name;
				} else {
					path = (path)?'['+tree.property.raw+']'+path:'['+tree.property.raw+']';
				}
				
				if (tree.object.type=='Identifier') {
					
					// like foo.bar ; were done with this path - push !
					Circular.log.debug('Circular.parser.recursePaths','adding path '+tree.object.name+path);
					
					if (path.indexOf('.')===0) {
						paths.push(tree.object.name+'.'+path.substring(1));
					} else {
						paths.push(Circular.config.rootscope+'.'+tree.object.name+path);
					}
					
				} else if (tree.object.type=='ThisExpression') {
					
					Circular.log.write('Circular.parser.recursePaths','adding path this, ignoring subs');
					
					// ignore any subpaths of 'this'
					paths.push('this');
					
				} else {
					if (tree.object.type=='MemberExpression') {
						
						// like foo.bar.quz ; recurse the object
						Circular.log.debug('Circular.parser.recursePaths','recursing member expression ..');
						this.recursePaths(tree.object,paths,path);						
					
					} else {
						
						// like foo(bar).quz ; the object is something weird. 
						// ignore the property .. but recurse the object
						this.recursePaths(tree.object,paths);	
					
					}
				}
			} else {
			
				// the property is some sort of thing itself:
				
				if (tree.object.type=='Identifier') {
					
					// like foo[bar.quz] - push the object, recurse the property
					Circular.log.debug('Circular.parser.recursePaths','adding identifier '+tree.object.name);
					paths.push(Circular.config.rootscope+'.'+tree.object.name);
					this.recursePaths(tree.property);	
					
				} else if (tree.object.type=='ThisExpression') {
					
					Circular.log.write('Circular.parser.recursePaths','adding path this');
					paths.push('this');
					// dont recurse this
					
				} else {
				
					// like foo.bar[quz(raz)] ; recurse both
					Circular.log.debug('Circular.parser.recursePaths','recursing member expression ..');
					this.recursePaths(tree.object,paths);	
					this.recursePaths(tree.property,paths);	
				
					
				}
				
			}
			
		} else if (tree.type=="CallExpression") {
		
			// like foo.bar(quz.baz) ;
			this.recursePaths(tree.arguments,paths);
			
			// think .toUpperCase()
			if (tree.callee && tree.callee.object) {
				this.recursePaths(tree.callee.object,paths);
			}
			
		} else if (tree.type=="AssignmentExpression") {
		
			// like foo.bar=baz*quz ; we only want the right hand
			this.recursePaths(tree.right,paths);
			
		} else {
		
			Circular.log.debug('Circular.parser.recursePaths','other tree.type ',tree.type);
		
			// unknown garbage. dig deeper.
			var ccnode = Object.getOwnPropertyNames(tree);
			for (var pc=0; pc<ccnode.length; pc++) {
				var key = ccnode[pc];
				if (typeof tree[key] == 'object') {
					if (Array.isArray(tree[key])) {
						for (var kc=0;kc<tree[key].length;kc++) {
							Circular.log.debug('Circular.parser.recursePaths','recursing '+key+':'+kc);
							this.recursePaths(tree[key][kc],paths);
						}
					} else {
						Circular.log.debug('Circular.parser.recursePaths','recursing '+key,tree[key]);
						this.recursePaths(tree[key],paths);
						
					}
				} else {
					Circular.log.debug('Circular.parser.recursePaths','ignoring '+key);
				}
				
			}
		}
		
	},
	
	
	isExpression	: function(expr) {
		// quick way to check - false pos are ok
		return (expr.substring(0,2)=="{{");
	},
	
	match	: function(expr) {
		// returns an array of matches or false
		Circular.log.debug('Circular.parser.match',expr);
		return expr.match(Circular.config.exprregex);
	},
	
	replace	: function(expr,func) {
		// opertes func replace on combined expressions
		Circular.log.debug('Circular.parser.replace',expr);
		return expr.replace(Circular.config.exprregex,func);
	},
	
	getFlags	: function(expr) {
		
		var parse = true, eval=true, watch=true;
		var matches = expr.match(Circular.parser.config.flagregex);
		if (matches) {
			return {
				expression: expr,
				parse			: (matches[0].indexOf('p')!=-1),
				evaluate	: (matches[0].indexOf('e')!=-1),
				watch			: (matches[0].indexOf('w')!=-1)
			}
		}
		return {
			expression: expr,
			parse			: true,
			evaluate	: true,
			watch			: true,
		}
	},
	
	// split a text into an array
	// of plain text string and {{expressions}}
	split	: function(text) {
		Circular.log.debug('Circular.parser.split',text);
		var exec; var result = []; 
		var cursor = 0;
		while (exec = Circular.config.exprregex.exec(text)) {
			if (cursor<exec.index) {
				result.push({text:text.substring(cursor,exec.index)});
			}
			result.push({expression:exec[0]});
			cursor = exec.index + exec[0].length;
		}
		if (cursor<text.length) {
			result.push({text:text.substring(cursor,text.length)});
		}
		return result;
	},
	
	
	// if you want the result in the context of a node,
	// call it like @parser.result.call(node,expr,ctx)	
	result	: function(expr,ctx) {
		// parse a single expression
		var parsed = Circular.parser.parse(expr,ctx);
		return Circular.parser.eval.call(this,parsed);
	},
	
	
	
	parse	: function(expr,ctx) {
		// parse a single expression
		parsed = expr.replace(/\$this/g,'$(this)');
		parsed = parsed.replace(/#this/g,ctx);
		parsed = parsed.replace(/#/g,ctx+'.');
		parsed = parsed.replace(/@/g,'Circular.');
		return parsed;
	},
	
	// evaluates a qualified expression.
	// this does nothing special, but try,catch.
	// if you want to eval this in the context of a node,
	// call it like parser.eval.call(node,expr)
	
	eval	: function(expr) {
		Circular.log.debug('Circular.parser.eval');
		var value = Circular.config.evalfail;
		try {
				value = eval(expr);
				Circular.log.debug("Circular.parser.eval",expr,value);
		} catch (err) {
			try {
				// maybe its an object def
				expr = '('+expr+')';
				var value = eval(expr);
				Circular.log.debug("Circular.parser.eval",expr,value);
			} catch (err) {
				Circular.log.error("Circular.parser.eval",expr,'fail',err);
			}
		}
		return value;
	},
	
	boolish	: function(str) {
		if (str) {
			if (str==='no') 		return false;
			if (str==='off') 		return false;
			if (str==='false') 	return false;
			if (str==='0') 			return false;
			return true;
		} else {
			if (str==='') return true;
			return false;
		}
	}
	
});
	