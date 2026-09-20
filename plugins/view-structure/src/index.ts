/**
 * view-structure: the protein's shape, with one residue marked.
 *
 * Mol* renders into a plain canvas here; no second UI framework is pulled in.
 * The structure bytes are handed in by the host, which fetched them under a
 * grant and keeps them on the device, so this module never touches the network.
 */
import type { PluginManifest } from '@gw/plugin-sdk';
import manifestJson from '../manifest.json';

export const manifest = manifestJson as PluginManifest;

export interface StructureOptions {
  /** mmCIF bytes; binary (BinaryCIF) or text, Mol* detects which. */
  data: Uint8Array<ArrayBuffer>;
  /** 1-based residue to mark, if any. */
  residue?: number | null;
  /** Colours from the page's design tokens. */
  colors: { protein: number; residue: number; background: number };
}

export interface StructureHandle {
  focusResidue(residue: number | null): Promise<void>;
  resize(): void;
  destroy(): void;
}

/** Mount a structure into `canvas`. Mol* is imported here so it loads on demand. */
export async function mountStructure(
  canvas: HTMLCanvasElement,
  parent: HTMLElement,
  options: StructureOptions,
): Promise<StructureHandle> {
  const [{ PluginContext }, { DefaultPluginSpec }, { Color }, { Script }, { StructureSelection }, { PluginCommands }, { MolScriptBuilder: MS }] =
    await Promise.all([
      import('molstar/lib/mol-plugin/context'),
      import('molstar/lib/mol-plugin/spec'),
      import('molstar/lib/mol-util/color'),
      import('molstar/lib/mol-script/script'),
      import('molstar/lib/mol-model/structure'),
      import('molstar/lib/mol-plugin/commands'),
      import('molstar/lib/mol-script/language/builder'),
    ]);

  const plugin = new PluginContext(DefaultPluginSpec());
  await plugin.init();
  if (!(await plugin.initViewerAsync(canvas, parent as HTMLDivElement))) {
    throw new Error('This browser could not start the 3D view (WebGL unavailable).');
  }
  await PluginCommands.Canvas3D.SetSettings(plugin, {
    settings: {
      renderer: { ...plugin.canvas3d!.props.renderer, backgroundColor: Color(options.colors.background) },
      // No coloured axis widget: this palette carries meaning elsewhere.
      camera: { ...plugin.canvas3d!.props.camera, helper: { axes: { name: 'off', params: {} } } },
    },
  });

  const data = await plugin.builders.data.rawData({ data: options.data });
  const trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif');
  const model = await plugin.builders.structure.createModel(trajectory);
  const structure = await plugin.builders.structure.createStructure(model);
  const polymer = await plugin.builders.structure.tryCreateComponentStatic(structure, 'polymer');
  if (polymer) {
    await plugin.builders.structure.representation.addRepresentation(polymer, {
      type: 'cartoon',
      color: 'uniform',
      colorParams: { value: Color(options.colors.protein) },
    });
  }

  let residueRef: Awaited<ReturnType<typeof plugin.builders.structure.tryCreateComponentFromExpression>> | undefined;

  /** Mark one residue: ball-and-stick in the accent, and point the camera at it. */
  const focusResidue = async (residue: number | null) => {
    if (residueRef) {
      await plugin.build().delete(residueRef).commit();
      residueRef = undefined;
    }
    const cell = structure.cell?.obj?.data;
    if (!residue || !cell) return;
    const expression = MS.struct.generator.atomGroups({
      'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.label_seq_id(), residue]),
    });
    const selection = Script.getStructureSelection(expression, cell);
    const loci = StructureSelection.toLociWithSourceUnits(selection);
    if (loci.elements.length === 0) return;
    residueRef = await plugin.builders.structure.tryCreateComponentFromExpression(
      structure,
      expression,
      `residue-${residue}`,
      { label: `Residue ${residue}` },
    );
    if (residueRef) {
      await plugin.builders.structure.representation.addRepresentation(residueRef, {
        type: 'ball-and-stick',
        color: 'uniform',
        colorParams: { value: Color(options.colors.residue) },
      });
    }
    // Keep some of the protein around the residue, rather than filling the view with it.
    plugin.managers.camera.focusLoci(loci, { extraRadius: 7, minRadius: 9, durationMs: 0 });
  };

  await focusResidue(options.residue ?? null);

  // Mol* sizes its canvas from the container; keep them in step.
  plugin.handleResize();
  plugin.canvas3d?.requestDraw();
  const observer = new ResizeObserver(() => {
    plugin.handleResize();
    plugin.canvas3d?.requestDraw();
  });
  observer.observe(parent);
  if (import.meta.env?.DEV) {
    console.debug('[view-structure] mounted', {
      canvas: [canvas.width, canvas.height],
      polymer: !!polymer,
      representations: plugin.managers.structure.hierarchy.current.structures.length,
    });
  }

  return {
    focusResidue,
    resize: () => {
      plugin.handleResize();
      plugin.canvas3d?.requestDraw();
    },
    destroy: () => {
      observer.disconnect();
      plugin.dispose();
    },
  };
}
