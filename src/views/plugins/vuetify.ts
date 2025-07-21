// plugins/vuetify/vuetify.js
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import '@mdi/font/css/materialdesignicons.css';
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import * as labsComponents from 'vuetify/labs/components'

export const vuetify = createVuetify({
    theme: {
        themes: {
            light: {
                dark: false,
                colors: {
                    primary: '#7F85F9', // #E53935 6B38FB 1C1E2C 7F85F9
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
