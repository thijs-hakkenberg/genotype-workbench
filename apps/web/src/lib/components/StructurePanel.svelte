<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { StructureHandle } from '@gw/view-structure';
  import { NetworkNotGranted } from '@gw/plugin-host';
  import { isStructureOnDevice, structureBytes } from '../structures';
  import { refreshEstimate } from '../services.svelte';

  let { accession, proteinName, residue, caption }: {
    accession: string;
    proteinName: string;
    residue: number | null;
    caption: string;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let holder = $state<HTMLDivElement>();
  let handle: StructureHandle | null = null;
  let phase = $state<'idle' | 'loading' | 'shown' | 'failed'>('idle');
  let error = $state('');
  let onDevice = $state(false);
  let loadedFor = '';

  $effect(() => {
    void accession;
    void isStructureOnDevice(accession).then((v) => (onDevice = v));
  });

  // Re-point the camera when another residue of the same protein is selected.
  $effect(() => {
    const r = residue;
    if (handle && loadedFor === accession) void handle.focusResidue(r);
  });

  async function show() {
    phase = 'loading';
    error = '';
    try {
      const bytes = await structureBytes(accession, proteinName);
      const { mountStructure } = await import('@gw/view-structure');
      handle?.destroy();
      const css = getComputedStyle(document.documentElement);
      const hex = (name: string, fallback: number) => {
        const v = css.getPropertyValue(name).trim();
        return /^#[0-9a-f]{6}$/i.test(v) ? Number.parseInt(v.slice(1), 16) : fallback;
      };
      handle = await mountStructure(canvas!, holder!, {
        data: bytes,
        residue,
        colors: {
          protein: hex('--color-neutral-500', 0x9397ab),
          residue: hex('--color-accent-400', 0xb5abfc),
          background: hex('--color-bg', 0x161826),
        },
      });
      loadedFor = accession;
      onDevice = true;
      phase = 'shown';
      void refreshEstimate();
    } catch (e) {
      error = e instanceof NetworkNotGranted ? 'Not shown: access to AlphaFold was not granted.' : e instanceof Error ? e.message : String(e);
      phase = 'failed';
    }
  }

  onDestroy(() => handle?.destroy());
</script>

<div class="structure">
  <div class="card-kicker">Protein structure</div>
  <h4 style="margin:6px 0 2px">{proteinName}</h4>
  <div class="faint" style="font-size:11px">{caption}</div>

  <!-- One canvas for the lifetime of the panel: Mol* keeps a reference to it,
       so the placeholder is an overlay rather than a different element. -->
  <div class="holder" bind:this={holder}>
    <canvas bind:this={canvas}></canvas>
    {#if phase !== 'shown'}
      <div class="overlay">
        {#if phase === 'loading'}
          <span class="faint">Loading the structure…</span>
        {:else}
          <button class="btn btn-primary" type="button" onclick={show}>
            {onDevice ? 'Show the 3D structure' : 'Download and show the 3D structure'}
          </button>
          <span class="faint" style="font-size:11px;max-width:300px;text-align:center">
            {onDevice
              ? 'Already on this device; nothing is sent.'
              : 'Asks AlphaFold for this one protein. It learns which protein you are looking at, and nothing about your genotype.'}
          </span>
        {/if}
      </div>
    {/if}
  </div>
  {#if phase === 'shown'}
    <div class="faint" style="font-size:10px;margin-top:6px">
      AlphaFold DB model AF-{accession}-F1 · CC BY 4.0 · a prediction, not an experimental structure · kept on this device
    </div>
  {/if}
  {#if error}<div class="error-box" style="margin-top:var(--space-3)">{error}</div>{/if}
</div>

<style>
  .structure { margin-top: var(--space-4); }
  .holder { position: relative; height: 280px; margin-top: var(--space-3); border-radius: var(--radius-sm); background: var(--color-neutral-900); overflow: hidden; }
  .holder canvas { width: 100%; height: 100%; display: block; }
  .overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); background: var(--color-neutral-900); }
</style>
