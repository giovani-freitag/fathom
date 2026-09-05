<script setup lang="ts">
import { useData, useRouter, withBase } from 'vitepress';
import { computed } from 'vue';

/**
 * The two languages, as flags.
 *
 * A globe with a dropdown behind it asks a reader to open something before they
 * can see what is on offer. There are two languages and there will not be
 * twelve, so both are on the bar.
 */
const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português' },
] as const;

const { page } = useData();
const router = useRouter();

/** Which language the page being read belongs to. */
const spoken = computed(() => (page.value.relativePath.startsWith('pt-BR/') ? 'pt-BR' : 'en'));

/**
 * The same page in the other language, or that language's front page.
 *
 * The deeper pages and the decision records are written once, in English, so a
 * reader switching from one of those has nowhere to land: they go to the front
 * page of the language they asked for rather than to a link that leads nowhere.
 */
function goTo(code: string): void {
    const path = page.value.relativePath.replace(/\.md$/, '');
    const rest = path.replace(/^(en|pt-BR)\//, '');
    const isShared = !/^(en|pt-BR)\//.test(path) || path.includes('/adr/');
    const wanted = isShared || code === spoken.value ? `${code}/` : `${code}/${rest}`;
    router.go(withBase(`/${wanted}`));
}
</script>

<template>
    <div class="flag-switch">
        <button
            v-for="language in LANGUAGES"
            :key="language.code"
            type="button"
            class="flag-switch__button"
            :class="{ 'flag-switch__button--on': spoken === language.code }"
            :aria-current="spoken === language.code"
            :title="language.label"
            :aria-label="language.label"
            @click="goTo(language.code)"
        >
            <svg v-if="language.code === 'en'" viewBox="0 0 20 14" aria-hidden="true">
                <rect width="20" height="14" fill="#fff" />
                <g fill="#b22234">
                    <rect width="20" height="2" y="0" />
                    <rect width="20" height="2" y="4" />
                    <rect width="20" height="2" y="8" />
                    <rect width="20" height="2" y="12" />
                </g>
                <rect width="9" height="8" fill="#3c3b6e" />
            </svg>
            <svg v-else viewBox="0 0 20 14" aria-hidden="true">
                <rect width="20" height="14" fill="#009c3b" />
                <path d="M10 1.6 18.4 7 10 12.4 1.6 7Z" fill="#ffdf00" />
                <circle cx="10" cy="7" r="3.1" fill="#002776" />
            </svg>
        </button>
    </div>
</template>

<style scoped>
.flag-switch {
    display: flex;
    align-items: center;
    gap: 2px;
}

.flag-switch__button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    opacity: 0.45;
    transition: opacity 0.2s, background-color 0.2s;
}

.flag-switch__button:hover {
    opacity: 0.85;
    background-color: var(--vp-c-bg-soft);
}

.flag-switch__button--on {
    opacity: 1;
    background-color: var(--vp-c-bg-soft);
}

.flag-switch__button svg {
    width: 20px;
    height: 14px;
    border-radius: 2px;
    /* A white flag on a white bar has no edge of its own. */
    box-shadow: 0 0 0 1px var(--vp-c-divider);
}
</style>
