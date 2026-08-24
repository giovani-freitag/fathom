import type { ChartSettingsPatch, ChartState } from '@core/modules/chart/chart-controller';
import { formatDuration } from '@core/domain/formatting';
import { resolveRecordedSpanMs } from '@core/modules/chart/viewport-policy';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog, Slider, Switch } from 'radix-ui';
import type { ReactElement } from 'react';
import { ControlButton } from '@ui/primitives/control-button';

/**
 * Travel of the intensity slider.
 *
 * Bounded to where the control still says something: below this the field goes
 * black and above it every bucket saturates, so a wider range would spend half
 * its travel on two useless pictures.
 */
const COLOUR_GAIN_RANGE = { minimum: 0.4, maximum: 3, step: 0.05 } as const;

interface DisplaySettingsSheetProps {
    readonly state: ChartState;
    readonly onChange: (patch: ChartSettingsPatch) => void;
}

/**
 * Display controls, as a sheet anchored to the bottom of the screen.
 *
 * Bottom-anchored on every size rather than centred on desktop: these are the
 * controls reached mid-gesture, and on a phone the top of the screen is the one
 * place a thumb cannot go.
 */
export function DisplaySettingsSheet({ state, onChange }: DisplaySettingsSheetProps): ReactElement {
    return (
        <Dialog.Root>
            <Dialog.Trigger asChild>
                <ControlButton aria-label="Ajustes de exibição">
                    <SlidersHorizontal className="size-4" />
                </ControlButton>
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
                <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-2xl border border-hairline bg-abyss-850 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/80">
                    <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                        <Dialog.Title className="text-sm font-semibold tracking-wide text-ink-100">
                            Exibição
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label="Fechar"
                                className="inline-flex size-9 items-center justify-center rounded-md text-ink-500 hover:bg-abyss-700 hover:text-ink-100"
                            >
                                <X className="size-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="space-y-5 px-4 py-4">
                        <label className="block space-y-2">
                            <span className="flex items-baseline justify-between text-xs text-ink-300">
                                Intensidade
                                <span className="numeric text-ink-500">{state.colourGain.toFixed(1)}×</span>
                            </span>
                            <Slider.Root
                                value={[state.colourGain]}
                                min={COLOUR_GAIN_RANGE.minimum}
                                max={COLOUR_GAIN_RANGE.maximum}
                                step={COLOUR_GAIN_RANGE.step}
                                onValueChange={([gain]) => { onChange({ colourGain: gain ?? 1 }); }}
                                className="relative flex h-11 w-full touch-none select-none items-center"
                            >
                                <Slider.Track className="relative h-1 w-full rounded-full bg-abyss-600">
                                    <Slider.Range className="absolute h-full rounded-full bg-phosphor" />
                                </Slider.Track>
                                <Slider.Thumb
                                    aria-label="Intensidade das cores"
                                    className="block size-5 rounded-full border-2 border-phosphor bg-abyss-900 outline-none focus-visible:ring-2 focus-visible:ring-phosphor/50"
                                />
                            </Slider.Root>
                        </label>

                        <SettingToggle
                            label="Agressões"
                            description="Bolhas de ordens executadas a mercado"
                            isOn={state.isTradeOverlayVisible}
                            onToggle={(isTradeOverlayVisible) => { onChange({ isTradeOverlayVisible }); }}
                        />

                        <SettingToggle
                            label="Perfil de volume"
                            description="Volume negociado por faixa de preço"
                            isOn={state.isVolumeProfileVisible}
                            onToggle={(isVolumeProfileVisible) => { onChange({ isVolumeProfileVisible }); }}
                        />

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-4 text-[11px]">
                            <dt className="text-ink-500">Gravado até agora</dt>
                            <dd className="numeric text-right text-ink-100">
                                {formatDuration(resolveRecordedSpanMs(state.instruments, state.instrumentSymbol))}
                            </dd>
                            <dt className="text-ink-500">Resolução</dt>
                            <dd className="numeric text-right text-ink-300">
                                {formatDuration(state.dataset.sampleIntervalMs)} por coluna
                            </dd>
                            <dt className="text-ink-500">Faixa de preço</dt>
                            <dd className="numeric text-right text-ink-300">
                                {state.dataset.priceBucketSize} por linha
                            </dd>
                            <dt className="text-ink-500">Colunas carregadas</dt>
                            <dd className="numeric text-right text-ink-300">{state.dataset.frames.length}</dd>
                            <dt className="text-ink-500">Lacunas na janela</dt>
                            <dd className="numeric text-right text-ink-300">{state.dataset.gaps.length}</dd>
                        </dl>

                        <p className="text-[11px] leading-relaxed text-ink-500">
                            Janelas maiores que o gravado ficam desabilitadas. Histórico de livro
                            não é recuperável: o gráfico só cobre o tempo em que o coletor esteve
                            rodando.
                        </p>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

interface SettingToggleProps {
    readonly label: string;
    readonly description: string;
    readonly isOn: boolean;
    readonly onToggle: (isOn: boolean) => void;
}

function SettingToggle({ label, description, isOn, onToggle }: SettingToggleProps): ReactElement {
    return (
        <label className="flex items-center justify-between gap-4">
            <span className="space-y-0.5">
                <span className="block text-xs text-ink-100">{label}</span>
                <span className="block text-[11px] text-ink-500">{description}</span>
            </span>
            <Switch.Root
                checked={isOn}
                onCheckedChange={onToggle}
                className="relative h-6 w-11 shrink-0 rounded-full border border-hairline bg-abyss-700 transition-colors data-[state=checked]:border-phosphor/60 data-[state=checked]:bg-phosphor/25"
            >
                <Switch.Thumb className="block size-4 translate-x-1 rounded-full bg-ink-500 transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-phosphor" />
            </Switch.Root>
        </label>
    );
}
