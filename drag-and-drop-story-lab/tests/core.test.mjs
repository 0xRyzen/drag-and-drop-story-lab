import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest, validateSettings, validatePlan, compilePrompt, generationParams, resolveElements, qaDisposition, protectedClip } from '../runtime/core.mjs';
import { next, absorb } from '../runtime/runner.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const settings=JSON.parse(fs.readFileSync(path.join(ROOT,'production.json')));
const hashes={skill:'a'.repeat(64),story:'b'.repeat(64)};
const op={allowed_repository:'example/test',allowed_branch:'main',allowed_episode_paths:['episodes/season-01/episode-01.md'],render_enabled:false,max_credits_per_episode:0,max_credits_per_clip:30};
const req={repository:'example/test',branch:'main',commit:'a'.repeat(40),path:'episodes/season-01/episode-01.md',mode:'plan'};
function fixture(n=6){
 const clips=Array.from({length:n},(_,i)=>({clip_index:i+1,title:`Test beat ${i+1}`,beat_ids:[`B${String(i+1).padStart(2,'0')}`],cast_tags:['jack-sheet','karega-sheet'],location_tag:'ruined-server-room',prop_tags:[],start_state:i?`End ${i}`:'Establish room',end_state:`End ${i+1}`,shots:[
 {start:0,end:5,camera:'Medium two-shot',action:'Jack observes the existing console.',dialogue:[{speaker:'Jack',voice_tag:'Grady',start:0.5,end:4.5,text:'This file was here before we arrived.'}]},
 {start:5,end:10,camera:'Close-up',action:'Karega considers the same screen.',dialogue:[{speaker:'Karega',voice_tag:'Arthur',start:5.5,end:9.5,text:'Then tell me why it just moved.'}]},
 {start:10,end:15,camera:'Medium view',action:'Both stay outside the solid console.',dialogue:[]}],audio:{ambience:'Low server hum.',music:'Original quiet tension motif.',sfx:[{time:11,cue:'One click.'}]}}));
 return {schema_version:1,season:1,episode:1,title:'Unit test only',duration_seconds:15*n,duration_reason:'Test fixture',skill_sha256:hashes.skill,story_sha256:hashes.story,beats:clips.map(c=>({id:c.beat_ids[0],description:c.title})),clips};
}
const check=p=>validatePlan(p,settings,hashes,{season:1,episode:1});
test('fixed current model and format',()=>assert.doesNotThrow(()=>validateSettings(settings)));
for(const n of [4,5,6,7,8])test(`${n} clips yields permitted ${n*15}s episode`,()=>assert.doesNotThrow(()=>check(fixture(n))));
test('under one minute rejected',()=>assert.throws(()=>check(fixture(3)),/DURATION/));
test('over two minutes rejected',()=>assert.throws(()=>check(fixture(9)),/DURATION/));
test('source hash cannot lie',()=>{const p=fixture();p.skill_sha256='wrong';assert.throws(()=>check(p),/HASH/);});
test('duplicate cast rejected',()=>{const p=fixture();p.clips[0].cast_tags=['jack-sheet','jack-sheet'];assert.throws(()=>check(p),/CAST/);});
test('duplicated story beat rejected',()=>{const p=fixture();p.clips[1].beat_ids=p.clips[0].beat_ids;assert.throws(()=>check(p),/COVERAGE/);});
test('timeline gaps rejected',()=>{const p=fixture();p.clips[0].shots[1].start=6;assert.throws(()=>check(p),/TIMELINE/);});
test('unapproved asset rejected',()=>{const p=fixture();p.clips[0].prop_tags=['magic-remote'];assert.throws(()=>check(p),/PROP/);});
test('voice swaps rejected',()=>{const p=fixture();p.clips[0].shots[0].dialogue[0].voice_tag='Arthur';assert.throws(()=>check(p),/VOICE/);});
test('rushed dialogue rejected',()=>{const p=fixture();p.clips[0].shots[0].dialogue[0].end=1;assert.throws(()=>check(p),/FAST/);});
test('read-only planning does not authorize render',()=>assert.throws(()=>validateRequest({...req,mode:'render'},op),/DISABLED/));
test('foreign repository rejected',()=>assert.throws(()=>validateRequest({...req,repository:'attacker/test'},op),/REPOSITORY/));
test('path traversal rejected',()=>assert.throws(()=>validateRequest({...req,path:'../../credentials'},op),/PATH/));
test('non-immutable revision rejected',()=>assert.throws(()=>validateRequest({...req,commit:'main'},op),/COMMIT/));
test('scene prompt includes dialogue, audio, geometry and one sheet binding each',()=>{const p=compilePrompt(fixture().clips[0]);for(const k of ['CAST LOCK','AMBIENCE','SFX','MUSIC','GEOMETRY','@Grady','@Arthur'])assert.ok(p.includes(k));assert.equal((p.match(/@jack-sheet/g)||[]).length,1);});
test('H3 continuation attaches previous frame and identities without native start_image',()=>{const c=fixture().clips[1],b=Object.fromEntries(['jack-sheet','karega-sheet','ruined-server-room'].map(t=>[t,{media_id:t+'-image'}]));const p=generationParams(c,b,{frame_id:'previous-frame',observed_end_state:'Same room'});assert.equal(p.medias.length,4);assert.equal(p.medias[0].value,'previous-frame');assert.ok(p.medias.every(x=>x.role==='image'));});
test('ambiguous same-named elements rejected',()=>assert.throws(()=>resolveElements([{name:'jack-sheet',status:'completed'},{name:'jack-sheet',status:'completed'}],['jack-sheet']),/AMBIGUOUS/));
const q={evidence_complete:true,hard_failures:[],warnings:[],observed_end_state:'Characters stand apart outside console.',audio_fidelity:'UNVERIFIED'};
test('clear intersection always fails regardless of cosmetic tolerance',()=>assert.equal(qaDisposition({...q,hard_failures:[{category:'solid_intersection',start:14,end:15,evidence:'Torso enters cabinet.'}]}),'FAIL'));
test('unreadable evidence cannot pass',()=>assert.equal(qaDisposition({...q,evidence_complete:false}),'REVIEW_REQUIRED'));
test('ordinary warning is preserved as WARN',()=>assert.equal(qaDisposition({...q,warnings:['Obscured hand cannot be verified.']}),'WARN'));
test('repair fingerprint protects dialogue',()=>{const a=fixture().clips[0],b=structuredClone(a);b.shots[0].dialogue[0].text='Something else';assert.notEqual(protectedClip(a),protectedClip(b));});
test('pending reservation never creates a duplicate paid submission',async()=>{const s={run_id:'a'.repeat(32),bindings:{},plan:fixture(4),clips:[{status:'RESERVED'}],credits:30};const r=await next(op,s);assert.equal(r.status,'SUBMISSION_UNKNOWN');});
test('job ID is durably saved immediately after submission response',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dnd-test-')), config={...op,state_root:tmp};
 const s={run_id:'b'.repeat(32),bindings:{},plan:fixture(4),settings,credits:30,pending:{id:'token',kind:'generate'},clips:[{status:'RESERVED',attempts:[],quote:30,params:{prompt:'test'}}]};
 const result=await absorb({action_id:'token',response:{results:[{id:'11111111-1111-4111-8111-111111111111',model:'minimax_h3'}]}},config,s);
 const stored=JSON.parse(fs.readFileSync(path.join(tmp,s.run_id,'state.json')));assert.equal(stored.clips[0].job_id,'11111111-1111-4111-8111-111111111111');assert.equal(result.stage,'WAIT');fs.rmSync(tmp,{recursive:true});
});
