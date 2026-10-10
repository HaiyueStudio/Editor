import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_CHAPTERS, TUTORIAL_STAGES, TUTORIAL_REFERENCES, findTutorial, searchTutorials } from '../dist/tutorialContent.js';
import { TUTORIAL_LABS, tutorialProject } from '../dist/tutorialLabs.js';
import { tutorialDiff } from '../dist/tutorialDiff.js';
import { validateProject } from '../dist/model.js';

test('65 progressive chapters have their own derivations, experiments, runnable examples and references',()=>{
 assert.equal(TUTORIAL_CHAPTERS.length,65);assert.equal(TUTORIAL_STAGES.length,8);
 assert.equal(new Set(TUTORIAL_CHAPTERS.map(c=>c.id)).size,65);
 assert.deepEqual(TUTORIAL_STAGES.map((_,i)=>TUTORIAL_CHAPTERS.filter(c=>c.stage===i).length),[4,4,15,11,14,4,9,4]);
 for(const [index,c] of TUTORIAL_CHAPTERS.entries()){
   for(const field of ['goal','intro','detail','formula','pitfall','exercise','change','expected']) assert.ok(c[field].trim().length>0,c.id+':'+field);
   assert.equal(c.steps.length,3);assert.ok(c.steps.every(step=>step.title && step.body.length>30),c.id);
   assert.ok(Object.values(c.experiment).every(value=>value.length>0));
   for(const id of c.references) assert.match(TUTORIAL_REFERENCES[id].url,/^https:\/\//);
   const lab=TUTORIAL_LABS.find(lab=>lab.id===c.id);assert.ok(lab,c.id);
   if(lab.baseId) assert.ok(TUTORIAL_CHAPTERS.slice(0,index).some(chapter=>chapter.id===lab.baseId),'base must precede chapter');
 }
 const normalized=TUTORIAL_LABS.map(lab=>lab.code.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,''));
 assert.equal(new Set(normalized).size,65,'chapter code differs beyond comments and whitespace');
});

test('existing deep links and Chinese/English search remain available',()=>{
 assert.equal(findTutorial('ellipse').id,'ellipse');assert.equal(findTutorial('missing').id,'pixels');
 assert.ok(searchTutorials('椭圆').some(c=>c.id==='ellipse-distance'));
 assert.ok(searchTutorials('ray marching').some(c=>c.id==='march'));
 assert.ok(searchTutorials('投影').some(c=>c.id==='capsule-distance'));
 assert.ok(searchTutorials('IQ').length>0);
 assert.equal(searchTutorials('no-such-chapter-98765').length,0);
 assert.equal(searchTutorials('   ').length,65);
});

test('every example creates a valid unsaved document and progressive input bindings',()=>{
 assert.equal(TUTORIAL_LABS.length,65);
 for(const lab of TUTORIAL_LABS){
   const a=tutorialProject(lab.id),b=tutorialProject(lab.id);
   assert.notEqual(a.id,b.id);assert.deepEqual(validateProject(a),a);assert.equal(a.assets.length,0);
 }
 const input=tutorialProject('interaction').passes[4];
 assert.deepEqual(input.channels.slice(0,3),[{kind:'builtin',texture:'future-city'},{kind:'keyboard'},{kind:'builtin',texture:'msdf'}]);
 const feedback=tutorialProject('feedback');
 assert.equal(feedback.passes[0].enabled,true);
 assert.deepEqual(feedback.passes[0].channels,[{kind:'buffer',pass:'buffer-a'},...input.channels.slice(0,3)]);
 assert.deepEqual(feedback.passes[4].channels[0],{kind:'buffer',pass:'buffer-a'});
 const movement=tutorialProject('keyboard-movement');
 assert.equal(movement.passes[0].enabled,true);
 assert.deepEqual(movement.passes[0].channels.slice(0,2),[{kind:'buffer',pass:'buffer-a'},{kind:'keyboard'}]);
 assert.deepEqual(movement.passes[4].channels.slice(0,2),[{kind:'builtin',texture:'future-city'},{kind:'buffer',pass:'buffer-a'}]);
 for(const id of ['keyboard-held','keyboard-toggle']) assert.deepEqual(tutorialProject(id).passes[4].channels[1],{kind:'keyboard'});
 assert.throws(()=>tutorialProject('missing'));
});

test('code comparisons reconstruct both examples and expose actual Boolean changes',()=>{
 for(const lab of TUTORIAL_LABS){
   const after=lab.code,before=TUTORIAL_LABS.find(l=>l.id===lab.baseId)?.code??'';
   const lines=tutorialDiff(before,after);
   assert.equal(lines.filter(l=>l.kind!=='added').map(l=>l.text).join('\n'),before);
   assert.equal(lines.filter(l=>l.kind!=='removed').map(l=>l.text).join('\n'),after);
   assert.ok(lines.some(l=>l.kind!=='same'),lab.id);
 }
 const diff=tutorialDiff(tutorialProject('boolean').passes[4].code,tutorialProject('intersection').passes[4].code);
 assert.ok(diff.some(l=>l.kind==='removed' && l.text.includes('min(a,b)')));
 assert.ok(diff.some(l=>l.kind==='added' && l.text.includes('max(a,b)')));
});
