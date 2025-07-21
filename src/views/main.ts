import { createApp } from 'vue'
import { createPinia } from 'pinia';
import '@/views/styles/index.scss';
import App from '@/views/App.vue'
import router from '@/views/router';
import {vuetify} from '@/views/plugins/vuetify'
import { loadFonts } from '@/views/plugins/webfontloader'
import store from '@/views/store'
import '@/views/permission'
// import { createI18n } from 'vue-i18n'
import  i18n from '@/views/lang';

loadFonts()
// const i18n = createI18n({
//   // something vue-i18n options here ...
// })

createApp(App)
  .use(createPinia())
  .use(vuetify)
  .use(router)
  .use(store)
  .use(i18n)
  .mount('#app').$nextTick(() => {
    const d = document.getElementById('_loading_');
    d?.setAttribute('class', 'la-ball-climbing-dot hide');
});

