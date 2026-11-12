import * as pc from 'playcanvas';
import { PLAZA_PORTALS } from '@chaos/shared';

const deckUrl = new URL('./assets/plaza-deck-v1.glb', import.meta.url).href;
const portalUrls = {
  dash: new URL('./assets/plaza-portal-dash-v1.glb', import.meta.url).href,
  dodge: new URL('./assets/plaza-portal-dodge-v1.glb', import.meta.url).href,
  lava: new URL('./assets/plaza-portal-lava-v1.glb', import.meta.url).href,
  team: new URL('./assets/plaza-portal-teamwork-v1.glb', import.meta.url).href,
};

/** Load containers once. Each arena view owns its instances and disposes them on transition. */
export class PlazaKit {
  private readonly models;

  constructor(app: pc.Application) {
    const load = (url: string) => new Promise<pc.ContainerResource>((resolve, reject) => {
      app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error || !asset?.resource) reject(new Error(`Could not load ${url}`));
        else resolve(asset.resource as pc.ContainerResource);
      });
    });
    this.models = Promise.all([load(deckUrl), ...PLAZA_PORTALS.map(portal => load(portalUrls[portal.preset]))])
      .catch(error => { console.warn('Could not load the plaza kit.', error); });
  }

  mount(root: pc.Entity, fallback: pc.Entity): void {
    let disposed = false;
    root.once('destroy', () => { disposed = true; });
    void this.models.then(models => {
      if (disposed || !models) return;
      root.addChild(models[0]!.instantiateRenderEntity());
      for (const [index, portal] of PLAZA_PORTALS.entries()) {
        const model = models[index + 1]!.instantiateRenderEntity();
        model.setLocalPosition(portal.x, 0, portal.z);
        model.setLocalEulerAngles(0, portal.yaw * pc.math.RAD_TO_DEG, 0);
        root.addChild(model);
      }
      const light = new pc.Entity('Plaza sunlight');
      light.addComponent('light', { type: 'directional', intensity: 0.55, color: new pc.Color(1, 0.95, 0.87) });
      light.setLocalEulerAngles(45, -35, 0);
      root.addChild(light);
      fallback.destroy();
    });
  }
}
