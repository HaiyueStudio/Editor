/** Names are changed at declarations/bindings, never by replacing source text.
 * WGSL keywords and reserved words: https://www.w3.org/TR/WGSL/#reserved-words
 * The parser reserves hy_, so generated names cannot collide with GLSL names.
 */
const RESERVED = new Set(`
alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield
bool f16 f32 i32 u32 array atomic ptr sampler sampler_comparison
select bitcast all any inverseSqrt dpdx dpdy dpdxFine dpdyFine dpdxCoarse dpdyCoarse
`.trim().split(/\s+/));

export function wgslIdentifier(name: string): string {
  const type = /^(?:vec[234](?:[fiuhb])?|mat[234]x[234][fh]?|texture_\w+)$/.test(name);
  return RESERVED.has(name) || type || name === '_' || name.startsWith('__') ? 'hy_user_' + name : name;
}
