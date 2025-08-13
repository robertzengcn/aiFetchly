<template>
    <v-card class="login_container">
        <div class="group">
            <v-card class="form">
                <v-card-title>{{ t('layout.login_title') }}</v-card-title>
                <div class="mt-8 mb-8 login-description">
                    <p>{{ t('layout.login_description') }}</p>
                </div>
                <div style="text-align: center">
                    <v-btn
                        color="primary" 
                        size="large"
                        prepend-icon="mdi-login"
                        :loading="isLoading"
                        :disabled="isLoading"
                        @click="redirectToLogin">
                        {{ isLoading ? t('layout.logging_in') : t('layout.login_with_browser') }}
                    </v-btn>
                    
                    <!-- Show login URL message -->
                    <div v-if="showLoginUrl" class="mt-4 login-url-section">
                        <p class="login-url-text">
                            {{ t('layout.login_url_message') }}
                        </p>
                        
                        <v-btn
                            color="secondary"
                            variant="outlined"
                            size="large"
                            prepend-icon="mdi-content-copy"
                            class="mt-2"
                            @click="copyToClipboard"
                        >
                            {{ t('layout.copy_login_url') }}
                        </v-btn>
                    </div>
                </div>
            </v-card>
        </div>
    </v-card>
    <v-dialog
        v-model="dialog"
        width="auto"
      >
        <v-card>
          <v-card-text>
           {{ alertContent }}
          </v-card-text>
          <v-card-actions>
            <v-btn color="primary" block @click="dialog = false">{{ t('layout.close_dialog') }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
</template>
<script setup lang="ts">
//import { UserModule } from '@/views/store/modules/user'
import {openPage, getLoginUrl} from "@/views/api/users"
import { onMounted, ref } from "vue";
import {receiveRedirectevent} from "@/views/api/users"
import router from '@/views/router';
//import { defineComponent } from "vue";
import {NATIVATECOMMAND} from "@/config/channellist"
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const alertContent=ref('');
const dialog=ref(false);    
const isLoading = ref(false);
const showLoginUrl = ref(false);
const loginUrl = ref<any>('');



onMounted(() => {
 
  receiveMsg()
})
const redirectToLogin = async () => {
    try {
        isLoading.value = true;
        //showLoginUrl.value = false; // Reset URL display
        
        // Get the login URL first
        const url = await getLoginUrl();
        console.log("Login URL:", url);
        loginUrl.value = url;
        showLoginUrl.value = true; // Show URL if browser doesn't open
        setTimeout(() => {
            if (isLoading.value) {
                isLoading.value = false;
                
                alertContent.value = t('layout.login_timeout');
                dialog.value = true;
            }
        }, 20000); 
        
        // Open the browser to the login page
        await openPage();
    } catch (error) {
        console.error('Login failed:', error);
        alertContent.value = t('layout.login_failed');
        dialog.value = true;
        isLoading.value = false; // Reset loading on error
        showLoginUrl.value = true; // Show URL even on error
    }
}

const copyToClipboard = async () => {
    try {
        // Handle the case where loginUrl might be the full response object
        let urlToCopy = loginUrl.value;
        if (typeof loginUrl.value === 'object' && loginUrl.value.data) {
            urlToCopy = loginUrl.value.data;
        }
        
        await navigator.clipboard.writeText(urlToCopy);
        alertContent.value = t('layout.url_copied');
        dialog.value = true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        alertContent.value = t('layout.copy_failed');
        dialog.value = true;
    }
}

const receiveMsg = () => {
    receiveRedirectevent(NATIVATECOMMAND, function (data)  {
        console.log("Received redirect event:", data);
        isLoading.value = false; // Reset loading state when receiving response
        showLoginUrl.value = false; // Hide URL when redirecting
        if (data.path) {
            router.push({
                name: data.path
            });
        }
      
    });
}

</script>
<style lang="scss" scoped>
.login_container {
    height: 100vh;
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.5s;
    position: relative;
    overflow: hidden;

    .frame {
        position: absolute;
        left: -5%;
        top: -5%;
        width: 110%;
        height: 110%;
        filter: blur(20px);
    }

    .group {
        display: flex;
        position: relative;
        z-index: 1;
        border-radius: 20px;
        overflow: hidden;

        .form {
            width: 360px;
            margin: 0 auto;
            //height: 300px;
            padding: 40px;
            text-align: center;

            .title {
                font-size: 36px;
                font-weight: 700;
                font-family: Roboto, sans-serif !important;
                margin-bottom: 20px;
            }
        }
    }
}

.login-description {
    text-align: center;
    color: rgba(0, 0, 0, 0.6);
    font-size: 16px;
}

.login-url-section {
    text-align: center;
    margin-top: 20px;
}

.login-url-text {
    color: rgba(0, 0, 0, 0.7);
    font-size: 14px;
    margin-bottom: 10px;
}

@media only screen and (max-width: 778px) {
    .login_container {
        .group {
            .form {
                background: transparent;
            }
        }
    }
}
</style>
