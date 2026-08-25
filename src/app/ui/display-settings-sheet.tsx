import type { ChartSettingsPatch, ChartState } from '../core/chart-controller.ts';
import { DEPTH_CUT_RANGE } from '../core/chart-dataset.ts';
import { formatDuration } from '../core/formatting.ts';
import { resolveRecordedSpanMs } from '../core/viewport-policy.ts';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog, Slider, Switch } from 'radix-ui';
import type { ReactElement } from 'react';
import { ControlButton } from './control-button.tsx';

/**
 * Travel of the intensity slider.
 *
 * Bounded to where the control still says something: below this the field goes
 * black and above it every bucket saturates, so a wider range would spend half
 * its travel on two useless pictures.
 */
const COLOUR_GAIN_RANGE = { minimum: 0.4, maximum: 3, step: 0.05 } as const;

/**
 * Renders a cut as the percentage of the book it sits at.
 *
 * Kept to a tenth when it needs one: the upper cut lives in the last percent,
 * where rounding to whole numbers would show every useful setting as 100%.
 */
function formatCut(percentile: number): string {
    const percent = percentile * 100;
    const text = Number.isInteger(percent)
        ? String(percent)
        : percent.toFixed(1).replace('.', ',');

    return `${text}%`;
}

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

                        <label className="block space-y-2">
                            <span className="flex items-baseline justify-between text-xs text-ink-300">
                                Corte inferior
                                <span className="numeric text-ink-500">
                                    {formatCut(state.depthFloorPercentile)}
                                </span>
                            </span>
                            <span className="block text-[11px] leading-snug text-ink-600">
                                Abaixo daqui o livro é pintado como vazio. Subir apaga a
                                agitação de fundo e deixa a parede sozinha.
                            </span>
                            <Slider.Root
                                value={[state.depthFloorPercentile]}
                                min={DEPTH_CUT_RANGE.floorMinimum}
                                max={DEPTH_CUT_RANGE.floorMaximum}
                                step={DEPTH_CUT_RANGE.floorStep}
                                onValueChange={([percentile]) => {
                                    onChange({ depthFloorPercentile: percentile ?? 0 });
                                }}
                                className="relative flex h-11 w-full touch-none select-none items-center"
                            >
                                <Slider.Track className="relative h-1 w-full rounded-full bg-abyss-600">
                                    <Slider.Range className="absolute h-full rounded-full bg-phosphor" />
                                </Slider.Track>
                                <Slider.Thumb
                                    aria-label="Corte inferior do mapa de cores"
                                    className="block size-5 rounded-full border-2 border-phosphor bg-abyss-900 outline-none focus-visible:ring-2 focus-visible:ring-phosphor/50"
                                />
                            </Slider.Root>
                        </label>

                        <label className="block space-y-2">
                            <span className="flex items-baseline justify-between text-xs text-ink-300">
                                Corte superior
                                <span className="numeric text-ink-500">
                                    {formatCut(state.depthSaturationPercentile)}
                                </span>
                            </span>
                            <span className="block text-[11px] leading-snug text-ink-600">
                                Onde a cor satura. Descer faz mais níveis chegarem ao topo
                                da rampa; subir reserva o topo para as maiores ordens.
                            </span>
                            <Slider.Root
                                value={[state.depthSaturationPercentile]}
                                min={DEPTH_CUT_RANGE.saturationMinimum}
                                max={DEPTH_CUT_RANGE.saturationMaximum}
                                step={DEPTH_CUT_RANGE.saturationStep}
                                onValueChange={([percentile]) => {
                                    onChange({ depthSaturationPercentile: percentile ?? 1 });
                                }}
                                className="relative flex h-11 w-full touch-none select-none items-center"
                            >
                                <Slider.Track className="relative h-1 w-full rounded-full bg-abyss-600">
                                    <Slider.Range className="absolute h-full rounded-full bg-phosphor" />
                                </Slider.Track>
                                <Slider.Thumb
                                    aria-label="Corte superior do mapa de cores"
                                    className="block size-5 rounded-full border-2 border-phosphor bg-abyss-900 outline-none focus-visible:ring-2 focus-visible:ring-phosphor/50"
                                />
                            </Slider.Root>
                        </label>

                        <SettingToggle
                            label="Candles"
                            description="Abertura, máxima, mínima e fechamento do preço médio"
                            isOn={state.isCandleOverlayVisible}
                            onToggle={(isCandleOverlayVisible) => { onChange({ isCandleOverlayVisible }); }}
                        />

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
