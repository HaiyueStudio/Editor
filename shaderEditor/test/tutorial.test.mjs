import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_CHAPTERS, TUTORIAL_STAGES, TUTORIAL_REFERENCES, findTutorial, searchTutorials } from '../dist/tutorialContent.js';
import { TUTORIAL_LABS, tutorialProject } from '../dist/tutorialLabs.js';
import { validateProject } from '../dist/model.js';
test('32 sequenced chapters form eight complete stages with exercises and resolvable original references',()=>{
 assert.equal(TUTORIAL_CHAPTERS.length,32);assert.equal(TUTORIAL_STAGES.length,8);
 assert.equal(new Set(TUTORIAL_CHAPTERS.map(c=>c.id)).size,32);
 TUTORIAL_STAGES.forEach((stage,index)=>{
   assert.equal(TUTORIAL_CHAPTERS.filter(c=>c.stage===index).length,4);
   assert.ok(TUTORIAL_LABS.some(lab=>lab.id===stage.lab));
 });
 for(const c of TUTORIAL_CHAPTERS){
   for(const field of ['goal','intro','detail','formula','pitfall','exercise']) assert.ok(c[field].trim().length>0,c.id+':'+field);
   for(const id of c.references) assert.match(TUTORIAL_REFERENCES[id].url,/^https:\/\//);
 }
});
test('chapter lookup and search handle deep links, unknown IDs, Chinese and English subjects',()=>{
 assert.equal(findTutorial('ellipse').id,'ellipse');assert.equal(findTutorial('missing').id,'pixels');
 assert.ok(searchTutorials('椭圆').some(c=>c.id==='ellipse'));
 assert.ok(searchTutorials('ray marching').some(c=>c.id==='march'));
 assert.ok(searchTutorials('IQ').length>0);
 assert.equal(searchTutorials('no-such-chapter-98765').length,0);
 assert.equal(searchTutorials('   ').length,32);
});
test('tutorial projects are fresh unsaved documents with valid pass bindings, including feedback',()=>{
 assert.equal(TUTORIAL_LABS.length,8);
 for(const lab of TUTORIAL_LABS){
   const a=tutorialProject(lab.id),b=tutorialProject(lab.id);
   assert.notEqual(a.id,b.id);assert.deepEqual(validateProject(a),a);assert.equal(a.assets.length,0);
 }
 const feedback=tutorialProject('feedback');
 assert.equal(feedback.passes[0].enabled,true);
 assert.deepEqual(feedback.passes[0].channels[0],{kind:'buffer',pass:'buffer-a'});
 assert.deepEqual(feedback.passes[4].channels[0],{kind:'buffer',pass:'buffer-a'});
 assert.throws(()=>tutorialProject('missing'));
});
