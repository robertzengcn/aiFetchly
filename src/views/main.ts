import { createApp } from 'vue'
import { createPinia } from 'pinia';
import './styles/index.scss';
import App from './App.vue'
import router from './router';
import {vuetify} from './plugins/vuetify'
import { loadFonts } from './plugins/webfontloader'
import store from './store'
import './permission'
// import { createI18n } from 'vue-i18n'
import  i18n from './lang';

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

