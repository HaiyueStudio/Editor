import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderGpuProvider, feedbackFormat } from '../dist/gpuPrecision.js';

function fakeGpu(features) {
  const device = { features: new Set() }, requests = [];
  class Adapter {
    #features = new Set(features);
    get features() { return this.#features; }
    get limits() { return this.#features.size; }
    async requestDevice(descriptor={}) {
      this.#features.has('anything'); // As with native adapters, the receiver must retain its brand.
      requests.push(descriptor); device.features = new Set(descriptor.requiredFeatures ?? []);
      return device;
    }
  }
  const adapter=new Adapter();
  const gpu={
    async requestAdapter(options) { assert.equal(this,gpu);assert.deepEqual(options,{powerPreference:'high-performance'});return adapter; },
    getPreferredCanvasFormat() { assert.equal(this,gpu);return 'bgra8unorm'; },
  };
  return {adapter,gpu,device,requests};
}

test('high precision requests the optional filtering feature without losing engine features, limits or native method receivers', async()=>{
  const {gpu,adapter,requests}=fakeGpu(['float32-filterable','timestamp-query']);
  const provider=shaderGpuProvider(gpu),wrapped=await provider.requestAdapter({powerPreference:'high-performance'});
  const descriptor={label:'Haiyue',requiredFeatures:['timestamp-query'],requiredLimits:{maxBindGroups:4}};
  const original=structuredClone(descriptor),method=adapter.requestDevice;
  assert.equal(provider.getPreferredCanvasFormat(),'bgra8unorm');assert.equal(wrapped.limits,2);
  const device=await wrapped.requestDevice(descriptor);
  assert.deepEqual(requests[0],{...descriptor,requiredFeatures:['timestamp-query','float32-filterable']});
  assert.deepEqual(descriptor,original);assert.equal(adapter.requestDevice,method);
  assert.equal(feedbackFormat(device.features),'rgba32float');
  await wrapped.requestDevice({requiredFeatures:['float32-filterable']});
  assert.deepEqual(requests[1].requiredFeatures,['float32-filterable']);
});

test('unsupported adapters retain their native request and use filterable half precision without requesting an invalid feature',async()=>{
  const {gpu,adapter,requests}=fakeGpu(['timestamp-query']);
  const wrapped=await shaderGpuProvider(gpu).requestAdapter({powerPreference:'high-performance'});
  assert.equal(wrapped,adapter);
  const device=await wrapped.requestDevice({requiredFeatures:['timestamp-query']});
  assert.deepEqual(requests[0].requiredFeatures,['timestamp-query']);
  assert.equal(feedbackFormat(device.features),'rgba16float');
});

test('unavailable adapters and native device request failures are preserved',async()=>{
  const unavailable=shaderGpuProvider({requestAdapter:async()=>null,getPreferredCanvasFormat:()=> 'bgra8unorm'});
  assert.equal(await unavailable.requestAdapter(),null);
  const failure=new Error('device lost during creation');
  const {gpu,adapter}=fakeGpu(['float32-filterable']);
  adapter.requestDevice=async()=>{throw failure;};
  const wrapped=await shaderGpuProvider(gpu).requestAdapter({powerPreference:'high-performance'});
  await assert.rejects(wrapped.requestDevice(),error=>error===failure);
});

test('precision follows enabled device features rather than merely advertised adapter features',()=>{
  assert.equal(feedbackFormat(new Set()),'rgba16float');
  assert.equal(feedbackFormat(new Set(['timestamp-query'])),'rgba16float');
  assert.equal(feedbackFormat(new Set(['float32-filterable'])),'rgba32float');
});
