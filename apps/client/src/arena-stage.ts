/** A built arena entity tree. Hidden until shown; destroy releases everything it owns. */
export interface StageView {
  readonly id: string;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Holds at most two arena trees: the one on screen and the next one, built
 * hidden in the background so a transition only flips visibility. Every other
 * tree is destroyed as soon as it stops being current or next.
 */
export class ArenaStage<View extends StageView> {
  private shown?: View;
  private queued?: View;

  constructor(private readonly build: (id: string) => View) {}

  get current(): View | undefined { return this.shown; }
  get next(): View | undefined { return this.queued; }

  /** Shows `id`, reusing the prefetched tree when it matches, and destroys the old one. */
  show(id: string): View {
    if (this.shown?.id === id) return this.shown;
    let view: View;
    if (this.queued?.id === id) {
      view = this.queued;
      this.queued = undefined;
    } else {
      view = this.build(id);
    }
    this.shown?.destroy();
    this.shown = view;
    view.setVisible(true);
    return view;
  }

  /** Builds `id` hidden ahead of time. An empty id, or the current arena, needs nothing. */
  prefetch(id: string): void {
    if (!id || id === this.shown?.id || id === this.queued?.id) return;
    this.queued?.destroy();
    this.queued = this.build(id);
    this.queued.setVisible(false);
  }

  dispose(): void {
    this.shown?.destroy();
    this.queued?.destroy();
    this.shown = this.queued = undefined;
  }
}
