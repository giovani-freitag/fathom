import type { ReactElement } from 'react';
import { usePanelSize } from '../react/use-panel-size.ts';
import { useIsViewportAtLeast } from '../react/use-viewport-width.ts';
import { EDITOR_SHELL_CLASSES, RAIL, SHEET } from './editor-shell.ts';

/**
 * What stands where the editor will be while the editor is still arriving.
 *
 * The same shape and the same size, so the panel does not move when it lands.
 * A rail here whatever the width was a phone opening a strip down its side,
 * holding it for as long as a compiler takes to download, and then throwing it
 * away for a sheet from the bottom.
 *
 * @returns An empty panel of the shape the real one will take.
 */
export function EditorPlaceholder(): ReactElement {
    const isWide = useIsViewportAtLeast('lg');
    const size = usePanelSize(isWide ? RAIL : SHEET);

    return (
        <aside
            aria-hidden="true"
            style={{ [isWide ? 'width' : 'height']: `${String(size.sizePx)}px` }}
            className={EDITOR_SHELL_CLASSES}
        />
    );
}
