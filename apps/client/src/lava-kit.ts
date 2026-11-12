import * as pc from 'playcanvas';
import { lavaLevel, moverCenter, moverWarns, type Mover } from '@chaos/shared';

const staticUrl = new URL('./assets/lava-arena-static-v1.glb', import.meta.url).href;
const moverUrls = [
  new URL('./assets/lava-lift-1-v1.glb', import.meta.url).href,
  new URL('./assets/lava-lift-2-v1.glb', import.meta.url).href,
  new URL('./assets/lava-lift-3-v1.glb', import.meta.url).href,
  new URL('./assets/lava-sweeper-v1.glb', import.meta.url).href,
];
const surfaceUrl = new URL('./assets/lava-surface-v1.glb', import.meta.url).href;

/** The art instances that need to follow the simulation's movers and rising lava level. */
export class LavaKitView {
  private readonly movers: Array<{ mover: Mover; entity: pc.Entity }>;
  private readonly surface: pc.Entity;
  private readonly warning: pc.Entity;
  private readonly scratch: [number, number, number] = [0, 0, 0];

  constructor(root: pc.Entity, models: readonly pc.ContainerResource[], movers: readonly Mover[]) {
    root.addChild(models[0]!.instantiateRenderEntity());
    this.movers = movers.map((mover, index) => {
      const entity = models[index + 1]!.instantiateRenderEntity();
      root.addChild(entity);
      return { mover, entity };
    });
    this.surface = models[models.length - 1]!.instantiateRenderEntity();
    root.addChild(this.surface);
    this.warning = new pc.Entity('Lava mover warning');
    this.warning.addComponent('light', { type: 'point', color: new pc.Color(1, 0.7, 0.15), intensity: 0, range: 8 });
    root.addChild(this.warning);
    this.pose(0, 0, 1);
  }

  pose(tick: number, elapsedTicks: number, roundTicks: number): void {
    let warningShown = false;
    for (const { mover, entity } of this.movers) {
      const center = moverCenter(mover, tick, this.scratch);
      entity.setPosition(...center);
      if (moverWarns(mover, Math.floor(tick))) {
        this.warning.setPosition(...center);
        warningShown = true;
      }
    }
    this.warning.light!.intensity = warningShown ? 2.4 : 0;
    this.surface.setPosition(0, lavaLevel(elapsedTicks, roundTicks), 0);
  }
}

/** Loads the approved Lava art once, then instantiates it for each temporary arena view. */
export class LavaKit {
  private readonly models: Promise<pc.ContainerResource[] | undefined>;

  constructor(app: pc.Application) {
    const load = (url: string) => new Promise<pc.ContainerResource>((resolve, reject) => {
      app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error || !asset?.resource) reject(new Error(`Could not load ${url}`));
        else resolve(asset.resource as pc.ContainerResource);
      });
    });
    this.models = Promise.all([load(staticUrl), ...moverUrls.map(load), load(surfaceUrl)])
      .catch(error => { console.warn('Could not load the Lava kit.', error); return undefined; });
  }

  mount(root: pc.Entity, fallback: pc.Entity, movers: readonly Mover[], mounted: (view: LavaKitView) => void): void {
    let disposed = false;
    root.once('destroy', () => { disposed = true; });
    void this.models.then(models => {
      if (disposed || !models) return;
      mounted(new LavaKitView(root, models, movers));
      fallback.destroy();
    });
  }
}
