/**
 * A render pipeline of the game's own asked for off the page's thread.
 *
 * A pipeline made the synchronous way holds the browser's GPU thread while
 * it compiles, and on a first visit that is the thread that presents the
 * intro's film. So the game's own passes (the post chain's, the sky's
 * capture) ask for theirs with `createRenderPipelineAsync`, all at once
 * where they are made, and whoever makes them waits for the answers where it
 * already waits. One the device refuses is made again the synchronous way,
 * so its error reaches the device's error handler as a pipeline made so
 * always did, and its maker is handed a pipeline all the same.
 */

/** The two calls asked of a device: any object with them. */
export type PipelineDevice = {
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
};

/** `descriptor`'s pipeline from `device`, compiled off the page's thread; made the synchronous way where that is refused. */
export function askRenderPipeline(device: PipelineDevice, descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
  return device.createRenderPipelineAsync(descriptor).catch(() => device.createRenderPipeline(descriptor));
}
