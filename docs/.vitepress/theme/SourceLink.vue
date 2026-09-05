<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';

const REPOSITORY = 'https://github.com/giovani-freitag/fathom';

const { page } = useData();

/** What the row is called, in the language of the page it is under. */
const said = computed(() => (page.value.relativePath.startsWith('pt-BR/')
    ? 'Ver o código no GitHub'
    : 'Read the source on GitHub'));
</script>

<template>
    <a class="source-link" :href="REPOSITORY" target="_blank" rel="noreferrer">
        <svg class="source-link__mark" viewBox="0 0 16 16" aria-hidden="true">
            <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                   0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                   -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                   .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                   -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
                   .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
                   .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
                   0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
        </svg>
        <span class="source-link__said">{{ said }}</span>
        <svg class="source-link__away" viewBox="0 0 10 10" aria-hidden="true">
            <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                d="M3 1h6v6M9 1 1.5 8.5"
            />
        </svg>
    </a>
</template>

<style scoped>
/*
 * A row rather than a lone glyph.
 *
 * The default theme puts the repository mark on its own line in the middle of
 * the menu, ruled off above and below: a twenty-pixel target with no label,
 * floating between two dividers. Here it reads and presses like every other
 * line of the menu it sits in.
 */
.source-link {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 4px;
    border-top: 1px solid var(--vp-c-divider);
    color: var(--vp-c-text-1);
    font-size: 14px;
    font-weight: 500;
    transition: color 0.2s;
}

.source-link:hover {
    color: var(--vp-c-brand-1);
}

.source-link__mark {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
}

.source-link__said {
    flex: 1;
    min-width: 0;
}

.source-link__away {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    color: var(--vp-c-text-3);
}
</style>
