import * as pc from 'playcanvas';
import { mountCarnivalScenery, mountPortalEffects } from './carnival-scenery.js';

const deckUrl = new URL('./assets/plaza-deck-v1.glb', import.meta.url).href;
/** Load containers once. Each arena view owns its instances and disposes them on transition. */
export class PlazaKit {
  private readonly deck;

  constructor(private readonly app: pc.Application) {
    const load = (url: string) => new Promise<pc.ContainerResource>((resolve, reject) => {
      app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error || !asset?.resource) reject(new Error(`Could not load ${url}`));
        else resolve(asset.resource as pc.ContainerResource);
      });
    });
    this.deck = load(deckUrl)
      .catch(error => { console.warn('Could not load the plaza kit.', error); });
  }

  mount(root: pc.Entity, fallback: pc.Entity): void {
    let disposed = false;
    root.once('destroy', () => { disposed = true; });
    void this.deck.then(deck => {
      if (disposed || !deck) return;
      root.addChild(deck.instantiateRenderEntity());
      mountPortalEffects(this.app, root);
      mountCarnivalScenery(this.app.graphicsDevice, root);
      const light = new pc.Entity('Plaza sunlight');
      light.addComponent('light', { type: 'directional', intensity: 1.05, color: new pc.Color(1, 0.95, 0.87) });
      light.setLocalEulerAngles(45, -35, 0);
      root.addChild(light);
      fallback.destroy();
    });
  }
}
