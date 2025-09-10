<template>
    <div v-if="!$route.meta.hideNav" class="header_title ml-4">
        <div>
            <v-breadcrumbs :items="routes">
                <template v-slot:prepend>
                    <router-link to="/" class="link"
                        ><v-icon size="small" icon="mdi-home-circle"></v-icon
                    ></router-link>
                    <li class="v-breadcrumbs-divider">/</li>
                </template>
            </v-breadcrumbs>
        </div>
        <div class="page_title">{{ pageTitle }}</div>
    </div>
</template>
<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';

const $route = useRoute();
const { t } = useI18n({ inheritLocale: true });
const routes = ref();
const pageTitle = computed(() => {
    const title = $route.meta.title as string;
    return translateRouteTitle(title);
});

function init() {
    const { matched } = $route;
    if (matched[0].path === '/dashboard') {
        routes.value = [
            {
                title: t('route.dashboard'),
                disabled: false,
                href: '/dashboard',
            },
        ];
        return;
    }
    if (matched[0].path === matched[1].path) {
        routes.value = [
            {
                title: t('route.home'),
                disabled: false,
                href: '/dashboard',
            },
            {
                title: translateRouteTitle(matched[0].meta.title as string),
                disabled: true,
                href: matched[0].path,
            },
        ];
        return;
    }
    routes.value = [];
    matched.forEach((route, index) => {
        if (index === matched.length - 1) {
            routes.value.push({
                title: translateRouteTitle(route.meta.title as string),
                exact: true,
                disabled: false,
                href: $route.path,
            });
        } else {
            routes.value.push({
                title: translateRouteTitle(route.meta.title as string),
                exact: false,
                disabled: true,
                href: route.path,
            });
        }
    });
    console.log(routes.value);
}

function translateRouteTitle(title: string | undefined): string {
    if (!title || typeof title !== 'string') {
        return title || '';
    }
    
    // Try to translate the title using the route translation key
    // const translationKey = `route.${title.toLowerCase().replace(/\s+/g, '_')}`;
    const translated = t(title);
    
    // If translation exists and is different from the key, use it
    if (translated !== title) {
        return translated;
    }
    
    return title;
}
init();
watch($route, init);
</script>
<style lang="scss">
.v-breadcrumbs__prepend {
    .mdi-home-circle {
        margin-right: 4px;
    }
}
.layout_title + div {
    padding-top: 0;
    margin-top: 0;
}
</style>
