<template>
    <v-container>
      <v-row>
        <v-col cols="12">
          <v-btn icon @click="goBack">
            <v-icon>mdi-arrow-left</v-icon>
          </v-btn>
          <v-card class="mt-4">
            <v-card-title>{{t('video.title')}}: {{ videoComEntity?.description?.title }}</v-card-title>
            <v-card-subtitle  v-if="videoComEntity?.detail.id" @click="openFileexplor(videoComEntity?.detail.id)">{{t('video.saved_path')}}: {{ videoComEntity?.detail.savepath }}</v-card-subtitle>
            <v-card-text>
                <p>{{t('video.description')}}:</p>
              <p>{{ videoComEntity?.description?.description }}</p>
              <v-divider></v-divider>
              <h3>{{t('video.caption_files')}}:</h3>
              <v-list>
                <v-list-item v-for="(caption, index) in videoComEntity?.caption" :key="index">
                  <v-list-item-content>
                    <v-list-item-title>{{ caption.caption_path }} </v-list-item-title>
                  </v-list-item-content>
                  <v-list-item-action>
                    <v-btn v-if="caption.id" icon @click="openCaptionFile(caption.id)">
                      <v-icon>mdi-file-document-arrow-right-outline</v-icon>
                    </v-btn>
                  </v-list-item-action>
                </v-list-item>
              </v-list>
              <v-divider></v-divider>
              <h3>{{t('video.translation_info')}}:</h3>
              <v-list>
                <v-list-item v-for="(translation, index) in videoComEntity?.translateInfolist" :key="index">
                  <v-list-item-content>
                    <v-list-item-title class="font-weight-bold">{{ t("language."+translation.language) }}</v-list-item-title>
                    
                    <v-expansion-panels flat>
                      <v-expansion-panel>
                        <v-expansion-panel-title>
                          <span class="text-subtitle-1">{{t('video.title')}}</span>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                          {{ translation.title }}
                        </v-expansion-panel-text>
                      </v-expansion-panel>
                      
                      <v-expansion-panel>
                        <v-expansion-panel-title>
                          <span class="text-subtitle-1">{{t('video.description')}}</span>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                          {{ translation.description }}
                        </v-expansion-panel-text>
                      </v-expansion-panel>
                    </v-expansion-panels>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
              <v-divider></v-divider>
              <p><strong>{{t('common.record_time')}}:</strong> {{ videoComEntity?.detail.record_time }}</p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </template>
  
  <script setup lang="ts">
  import { ref,onMounted } from 'vue';
  import { useRouter,useRoute } from 'vue-router';
  import {getVideoDetail,openFileexplor,openCaptionfile} from '@/views/api/video'
//   import {CommonIdrequest} from "@/entityTypes/commonType";
  import {VideoCompotionEntity} from "@/entityTypes/videoType";
  import { useI18n } from "vue-i18n";

  const { t } = useI18n({ inheritLocale: true });
  const $route = useRoute();
  const router = useRouter();
  const videoId=ref<number>(0)

  const videoComEntity = ref<VideoCompotionEntity>();
  const FakeAPI = {

  async fetch(id: number): Promise<VideoCompotionEntity> {
    // const data: CommonIdrequest<number> = {
    //   id: id
    // }
    return await getVideoDetail(id);
  },
};
const initialize = async () => {
    if ($route.params.id) {
        videoId.value = Number($route.params.id.toString());
        if(videoId.value>0){
            const res = await FakeAPI.fetch(videoId.value);
            console.log(res)
            videoComEntity.value = res;
        }
    }


};
  
  const goBack = () => {
    router.back();
  };
  const openCaptionFile = (fileId: number) => {
    openCaptionfile(fileId);
    };
  onMounted(() => {
    initialize();
  })
  </script>
  
  <style scoped>
  /* Add any additional styles if needed */
  </style>