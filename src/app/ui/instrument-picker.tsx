import type { InstrumentCoverage } from '../../shared/core/api-contract.ts';
import { memo, type ReactElement } from 'react';
import { Select } from './select.tsx';
import { useTranslate } from '../react/use-appearance.ts';

interface InstrumentPickerProps {
    readonly instruments: readonly InstrumentCoverage[];
    readonly selectedSymbol: string | null;
    readonly onSelect: (instrumentSymbol: string) => void;
}

/**
 * Picks which recorded contract the chart shows.
 */
function InstrumentPickerComponent({
    instruments,
    selectedSymbol,
    onSelect,
}: InstrumentPickerProps): ReactElement {
    const translate = useTranslate();

    return (
        <Select
            isLead
            value={selectedSymbol ?? ''}
            label={translate('instrument.label')}
            onSelect={onSelect}
            choices={instruments.map((instrument) => ({
                value: instrument.instrumentSymbol,
                label: instrument.instrumentSymbol,
            }))}
        />
    );
}

/**
 * Re-rendered only when what it shows changes.
 *
 * A drag rewrites the viewport many times a second and the whole page follows
 * it; this reads none of that, and rebuilding its menu each time was the
 * costliest thing on the screen during a drag.
 */
export const InstrumentPicker = memo(InstrumentPickerComponent);
