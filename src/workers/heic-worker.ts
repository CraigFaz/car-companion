// Runs heic2any in an isolated Web Worker so that WASM crashes or hangs
// are fully contained — terminating the worker tears down its WASM heap,
// and the next conversion gets a completely fresh instance.
self.onmessage = async (event: MessageEvent<{ arrayBuffer: ArrayBuffer }>) => {
  try {
    const { default: heic2any } = await import('heic2any')
    const blob = new Blob([event.data.arrayBuffer], { type: 'image/heic' })
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 })
    const result = Array.isArray(converted) ? converted[0] : (converted as Blob)
    const resultBuffer = await result.arrayBuffer()
    self.postMessage({ success: true, arrayBuffer: resultBuffer }, { transfer: [resultBuffer] })
  } catch (err) {
    self.postMessage({ success: false, error: err instanceof Error ? err.message : String(err) })
  }
}
