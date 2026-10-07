import test from 'node:test';
import assert from 'node:assert/strict';
import {EDITOR_OPERATION_API_VERSION,defineEditorOperation,copyEditorJson,validateEditorOperationValue} from '../dist/index.js';
const descriptor=()=>({id:'sample.inspect',version:1,title:'Inspect',target:'document',access:'read',documentKinds:['sample.project'],input:{type:'object',properties:{amount:{type:'integer',minimum:1,maximum:10}},required:['amount']},output:{type:'json'}});
test('versioned descriptors are detached, deeply frozen, and validate schema vocabulary',()=>{
 assert.equal(EDITOR_OPERATION_API_VERSION,'1');const original=descriptor(),owned=defineEditorOperation(original);original.input.properties.amount.maximum=20;assert.equal(owned.input.properties.amount.maximum,10);assert(Object.isFrozen(owned.input.properties));
 for(const patch of [{version:2},{id:'bad id'},{target:'unknown'},{access:'admin'},{input:{type:'object',properties:{},required:['missing']}},{input:{type:'string',pattern:'.*'}},{input:{type:'string',minLength:4,maxLength:2}},{input:{type:'integer',maximum:NaN}},{documentKinds:[]}])assert.throws(()=>defineEditorOperation({...descriptor(),...patch}));
});
test('value schemas validate closed objects, nested arrays, enum, bounds and required fields',()=>{
 const schema=defineEditorOperation(descriptor()).input;validateEditorOperationValue(schema,copyEditorJson({amount:2}));
 for(const value of [{amount:1.5},{amount:11},{amount:'1'},{},{amount:2,extra:true}])assert.throws(()=>validateEditorOperationValue(schema,value));
 const array={type:'array',items:{type:'string',enum:['a','b']},maxItems:2};validateEditorOperationValue(array,['a','b']);assert.throws(()=>validateEditorOperationValue(array,['c']));assert.throws(()=>validateEditorOperationValue(array,['a','b','a']));
});
test('JSON boundary rejects cycles, getters, sparse data, binary arrays and oversized values',()=>{
 const cyclic={};cyclic.self=cyclic;let invoked=false;const getter={get secret(){invoked=true;return 1;}};
 for(const value of [cyclic,getter,new Uint8Array(4),new Date(),NaN,Infinity,undefined,()=>{},[undefined],new Array(5),{x:1n},'x'.repeat(1048577)])assert.throws(()=>copyEditorJson(value));assert.equal(invoked,false);
 let deep={};for(let i=0;i<40;i++)deep={next:deep};assert.throws(()=>copyEditorJson(deep));
 const owned=copyEditorJson(JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}'));assert(Object.hasOwn(owned,'__proto__'));assert.equal({}.polluted,undefined);assert.equal(owned.constructor,'data');assert(Object.isFrozen(owned.__proto__));
});
