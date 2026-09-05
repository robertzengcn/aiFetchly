// plugins/vuetify/vuetify.js
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import '@mdi/font/css/materialdesignicons.css';
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import * as labsComponents from 'vuetify/labs/components'

import { aifetchlyDark, aifetchlyLight } from '@/views/design/tokens';

/**
 * Theme colors derive from the typed convergence palettes (design §7.2).
 * `light` keeps its historical name so existing `:root[theme]` selectors and
 * `mainStore.theme` behavior stay compatible; both themes now carry the full
 * semantic set consumed by --app-* aliases in styles/tokens.scss.
 */
export const vuetify = createVuetify({
    theme: {
        defaultTheme: 'light',
        themes: {
            light: {
                dark: false,
                colors: {
                    primary: aifetchlyLight.primary,
                    background: aifetchlyLight.background,
                    surface: aifetchlyLight.surface,
                    'surface-variant': aifetchlyLight.surfaceHover,
                    secondary: aifetchlyLight.borderStrong,
                    success: aifetchlyLight.success,
                    warning: aifetchlyLight.warning,
                    error: aifetchlyLight.danger,
                    info: aifetchlyLight.primary,
                    'on-background': aifetchlyLight.text,
                    'on-surface': aifetchlyLight.text,
                },
            },
            aifetchlyDark: {
                dark: true,
                colors: {
                    primary: aifetchlyDark.primary,
                    background: aifetchlyDark.background,
                    surface: aifetchlyDark.surface,
                    'surface-variant': aifetchlyDark.surfaceHover,
                    secondary: aifetchlyDark.borderStrong,
                    success: aifetchlyDark.success,
                    warning: aifetchlyDark.warning,
                    error: aifetchlyDark.danger,
                    info: aifetchlyDark.primary,
                    'on-background': aifetchlyDark.text,
                    'on-surface': aifetchlyDark.text,
                },
            },
        },
    },
    icons: {
        defaultSet: 'mdi',
        sets: {},
    },
    components:{
        ...components,
        ...labsComponents,   
    },
    directives
});
