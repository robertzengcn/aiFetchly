<template>
    <div class="container fluid grid-list-xl pa-0">
        <v-row align="center" justify="center" dense>
            <v-col v-for="card in homeCardlist" :key="card.title" cols="12" md="3">
               
              <v-card   
                  class="mx-auto homecard"
                  :prepend-icon=card.prependIcon
                  :subtitle=card.subtitle
                  :title=card.title
                  :appendIcon=card.appendIcon
                  link
                  hover
                  @click="cardRouter(card.link)"
                >
                  <v-card-text>{{card.description}}</v-card-text>
                </v-card>
              
              </v-col>
        </v-row>
    </div>
</template>
<script setup lang="ts">
import {useI18n} from "vue-i18n";
import {homecardEntity} from "@/entityTypes/homecard-type";
import router from "../router";
const {t} = useI18n({inheritLocale: true});
const cardRouter=(link:string|undefined)=>{
  if(link){
    router.push(link)
  }
}
const homeCardlist: homecardEntity[] = [
  {
        title: t('home.video_download_title'),
        subtitle: t('home.video_download_subtitle'),
        prependIcon: 'mdi-account',
        description: t('home.video_download_description'),
        link: '/video/download'
    },
    {
        title: t('home.search'),
        subtitle: t('home.search_scraper'),
        prependIcon: 'mdi-account',
        description: t('home.search_description'),
        link:'/search/form'
    },
    // {
    //     title: t('home.yellowpage'),
    //     subtitle: t('home.yellowpage_scraper'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.yellowpage_description')
    // },
    // {
    //     title: t('home.socialmedia'),
    //     subtitle: t('home.socialmedia_scraper'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.socialmedia_description')
    // },
    // {
    //     title: t('home.socialshare'),
    //     subtitle: t('home.socialshare_subtitle'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.socialshare_description')
    // },
    {
        title: t('home.emailextraction'),
        subtitle: t('home.emailextraction_subtitle'),
        prependIcon: 'mdi-alarm',
        appendIcon: 'mdi-crown',
        description: t('home.emailextraction_description'),
        link:'/emailextraction/form'
    },
    {
        title: t('home.emailmarketing'),
        subtitle: t('home.emailmarketing_subtitle'),
        prependIcon: 'mdi-alarm',
        appendIcon: 'mdi-crown',
        description: t('home.emailmarketing_description'),
        link:'/emailextraction/form'
    },
    // {
    //   title: t('home.tiktok_marketing_title'),
    //     subtitle: t('home.tiktok_marketing_subtitle'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.tiktok_marketing_description')
    // },
    // {
    //   title: t('home.youtube_marketing_title'),
    //     subtitle: t('home.youtube_marketing_subtitle'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.youtube_marketing_description')
    // },
    // {
    //   title: t('home.video_translation_title'),
    //     subtitle: t('home.video_translation_subtitle'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.video_translation_description')
    // }
    //     {
    //   title: t('home.account_manage'),
    //     subtitle: t('home.account_manage_subtitle'),
    //     prependIcon: 'mdi-alarm',
    //     description: t('home.account_manage_description'),
    //     link:'/socialaccount/list'
    // },
]
</script>
<style scoped>
.homecard {
  height: 145px;
}
</style>
