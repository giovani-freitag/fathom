import { HeatmapApiError } from '@core/services/heatmap-api/heatmap-api-service';

/**
 * Turns a load failure into something worth putting on screen.
 *
 * A driver's own message is written for whoever is reading a stack trace, in
 * whatever language the library was written in. What a reader needs is which
 * side broke and whether waiting will help.
 *
 * @param error - Whatever the load rejected with.
 * @returns One sentence, in the interface's language.
 */
export function describeLoadFailure(error: unknown): string {
    if (error instanceof HeatmapApiError) {
        if (error.status === 0) {
            return 'O gateway não respondeu. Verifique se ele está rodando.';
        }
        if (error.status >= 500) {
            return 'O gateway falhou ao responder. O arquivo pode estar indisponível.';
        }
        if (error.status >= 400) {
            return 'O gateway recusou a consulta.';
        }
    }
    return 'Não foi possível carregar a janela.';
}
