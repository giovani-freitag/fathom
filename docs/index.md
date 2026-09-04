---
layout: page
title: Fathom
---

<script setup>
import { onMounted } from 'vue';
import { useRouter, withBase } from 'vitepress';

// English unless the reader's browser asks for Portuguese. Neither language is
// at the root, so this is the one thing that has to decide, and a reader who
// disagrees has the switcher in the bar above.
const router = useRouter();
onMounted(() => {
    const wantsPortuguese = navigator.language?.startsWith('pt') === true;
    router.go(withBase(wantsPortuguese ? '/pt-BR/' : '/en/'));
});
</script>

<div style="padding: 6rem 1.5rem; text-align: center;">
    <p><a href="./en/">English</a> · <a href="./pt-BR/">Português</a></p>
</div>
