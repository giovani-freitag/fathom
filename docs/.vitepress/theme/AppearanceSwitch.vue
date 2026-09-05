<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useData } from 'vitepress';

/** Where VitePress keeps the choice, so a reload opens on the same one. */
const STORAGE_KEY = 'vitepress-theme-appearance';

type Choice = 'auto' | 'light' | 'dark';

const CHOICES: readonly { value: Choice; label: string }[] = [
    { value: 'auto', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
];

const { isDark } = useData();
const chosen = ref<Choice>('auto');
const systemIsDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

/**
 * Applies a choice, and writes it down as one of three rather than two.
 *
 * VitePress stores light or dark. Writing `auto` back after it has stored one of
 * those is what keeps "system" a choice a reader can return to, instead of the
 * theme they happened to be on when they picked it.
 */
async function choose(choice: Choice): Promise<void> {
    chosen.value = choice;
    isDark.value = choice === 'dark' || (choice === 'auto' && systemIsDark?.matches === true);

    await nextTick();
    globalThis.localStorage?.setItem(STORAGE_KEY, choice);
}

/** Follows the system while that is what the reader asked for. */
function handleSystemChange(event: MediaQueryListEvent): void {
    if (chosen.value === 'auto') {
        isDark.value = event.matches;
    }
}

onMounted(() => {
    const held = globalThis.localStorage?.getItem(STORAGE_KEY);
    chosen.value = held === 'light' || held === 'dark' ? held : 'auto';
    systemIsDark?.addEventListener('change', handleSystemChange);
});

onUnmounted(() => { systemIsDark?.removeEventListener('change', handleSystemChange); });
</script>

<template>
    <div class="appearance-switch" role="radiogroup" aria-label="Appearance">
        <button
            v-for="choice in CHOICES"
            :key="choice.value"
            type="button"
            role="radio"
            class="appearance-switch__button"
            :class="{ 'appearance-switch__button--on': chosen === choice.value }"
            :aria-checked="chosen === choice.value"
            :title="choice.label"
            :aria-label="choice.label"
            @click="choose(choice.value)"
        >
            <svg v-if="choice.value === 'auto'" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="2.5" y="4" width="19" height="13" rx="2" />
                <path d="M8 20h8" />
            </svg>
            <svg v-else-if="choice.value === 'light'" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
            </svg>
        </button>
    </div>
</template>

<style scoped>
.appearance-switch {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 10px;
}

.appearance-switch__button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--vp-c-text-3);
    transition: color 0.2s, background-color 0.2s;
}

.appearance-switch__button:hover {
    color: var(--vp-c-text-1);
}

.appearance-switch__button--on {
    color: var(--vp-c-brand-1);
    background-color: var(--vp-c-bg-soft);
}

.appearance-switch__button svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}
</style>
