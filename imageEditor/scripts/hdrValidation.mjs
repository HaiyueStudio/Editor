export const expectedHdrSamples=(ev=0)=>[0,.18,1,2,4,8,4,4].flatMap((v,i)=>{const a=i===6?.5:i===7?0:1,x=v*2**ev,y=x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;return [y*a,y*a,y*a,a];});
export const HDR_BASE_CHECKS=['fixture-preserved','sdr-fallback','rgb16-fallback','ui-report'];
export const HDR_GPU_CHECKS=['float-readback','exposure-preview','transparent-alpha','pointer-target'];
export const HDR_SIMULATED_CHECKS=['media-switch','device-loss-recovery','configure-failure-recovery','adapter-failure-recovery','stale-frame'];
/** Capability observations and GPU data cannot certify physical luminance. */
export function validateHdrEvidence(report,{requireHdr=false}={}){
 if(report.schemaVersion!==1||!['environment','simulated'].includes(report.mode)||report.physicalLuminanceVerified!==false)throw Error('HDR report schema or physical certification claim is invalid');
 if(!report.environment||!['high','standard'].includes(report.environment.dynamicRange)||typeof report.runner?.headless!=='boolean'||typeof report.runner?.gpuTestFlags!=='boolean')throw Error('Missing environment or runner identity');
 if(report.mode==='environment'&&(report.mediaEmulated||report.runner.gpuTestFlags))throw Error('Native environment run must not override media or force WebGPU');
 if(report.mode==='simulated'&&report.mediaEmulated!==true)throw Error('Simulated run must disclose media emulation');
 if(!Array.isArray(report.checks)||new Set(report.checks.map(c=>c.id)).size!==report.checks.length)throw Error('Missing or duplicate HDR checks');
 const required=[...HDR_BASE_CHECKS,...(report.hdrActive?HDR_GPU_CHECKS:[]),...(report.mode==='simulated'?HDR_SIMULATED_CHECKS:[])];
 for(const id of required)if(report.checks.find(c=>c.id===id)?.status!=='passed')throw Error('HDR check failed or missing: '+id);
 if(report.mode==='simulated'&&!report.hdrActive)throw Error('Simulated GPU path did not run');
 if(report.hdrActive){
  const config=report.activeConfiguration;
  if(config?.format!=='rgba16float'||config?.toneMapping!=='extended'||config?.colorSpace!=='srgb')throw Error('HDR canvas configuration mismatch');
  const {actual,expected,tolerance}=report.readback??{};
  if(!Array.isArray(actual)||actual.length!==32||!Array.isArray(expected)||actual.length!==expected.length||tolerance!==0.006||!expected.some(v=>v>1)||!actual.some(v=>v>1))throw Error('Missing HDR float samples or invalid tolerance');
  if(expected.some((v,i)=>v!==expectedHdrSamples()[i]))throw Error('HDR reference samples changed');
  if(actual.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(expected[i])||Math.abs(v-expected[i])>tolerance))throw Error('HDR readback differs from reference');
 }else if(!report.unavailableReason)throw Error('HDR unavailability must include a reason');
 const native=report.mode==='environment'&&!report.runner.headless&&report.environment.dynamicRange==='high'&&report.hdrActive;
 if(report.hdrActive&&report.mode==='environment'&&report.environment.dynamicRange!=='high')throw Error('HDR active without natural HDR capability');
 if(requireHdr&&!native)throw Error('Native headed HDR environment acceptance is unavailable; inspect the saved report');
 return {status:report.mode==='simulated'?'simulated-hdr-passed':native?'native-hdr-software-passed':report.hdrActive?'headless-hdr-software-passed-native-unverified':'sdr-fallback-passed-hdr-unavailable',nativeHdrSoftwareVerified:native,physicalHdrCertification:'pending',physicalLuminanceVerified:false};
}
