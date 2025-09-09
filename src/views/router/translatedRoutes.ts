import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouteRecordRaw } from 'vue-router';
import Layout from '@/views/layout/layout.vue';

// Function to create routes with computed translations
export const createTranslatedRoutes = (): RouteRecordRaw[] => {
  const { t } = useI18n({ inheritLocale: true });
  
  return [
    {
      path: '/',
      redirect: '/dashboard/home',
      name: 'Dashboard',
      meta: {
        visible: false,
        title: computed(() => t('router.dashboard')),
        icon: 'mdi-view-dashboard',
      },
      component: Layout,
      children: [
        {
          path: '/dashboard/home',
          name: 'home',
          meta: {
            title: computed(() => t('router.home')),
            icon: 'mdi-home',
            keepAlive: false,
            visible: false,
          },
          component: () => import('@/views/dashboard/home.vue'),
          children: [],
        }
      ],
    },
    {
      path: '/systemsetting',
      name: 'system_setting',
      meta: {
        visible: false,
        title: computed(() => t('router.system_setting')),
        icon: 'mdi-cog',
      },
      component: Layout,
      children: [
        {
          path: 'index',
          name: 'system_setting_index',
          meta: {
            title: computed(() => t('router.system_setting')),
            icon: 'mdi-cog-outline',
            keepAlive: false,
            visible: true,
          },
          component: () => import('@/views/pages/systemsetting/index.vue'),
          children: [],
        }
      ],
    },
    {
      path: '/campaign',
      name: 'campaign',
      meta: {
        visible: false,
        title: computed(() => t('router.campaign')),
        icon: 'mdi-bullhorn',
      },
      component: Layout,
      children: [
        {
          path: 'edit/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/campaign/campaign.vue'),
          name: 'EditCampaign',
          meta: {
            title: computed(() => t('router.edit_campaign')),
            noCache: true,
            activeMenu: '/campaign/list',
          }
        },
        {
          path: 'list',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/campaign/campaign.vue'),
          name: 'CampaignList',
          meta: {
            visible: true,
            title: computed(() => t('router.campaign_list')),
            icon: 'mdi-format-list-bulleted'
          }
        }
      ]
    },
    {
      path: '/socialtask',
      name: 'socialtask',
      meta: {
        title: computed(() => t('router.social_task')),
        icon: 'mdi-account-group',
      },
      component: Layout,
      children: [
        {
          path: 'edit/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/socialtask/socialtaskdetail.vue'),
          name: 'EditSocialtask',
          meta: {
            title: computed(() => t('router.edit_social_task')),
            noCache: true,
            activeMenu: '/socialtask/edit',
          }
        },
        {
          path: 'create/:campaignId(\\d+)',
          component: () => import(/* webpackChunkName: "socialtaskdetail" */ '@/views/pages/socialtask/socialtaskdetail.vue'),
          name: 'CreateSocialtask',
          meta: {
            title: computed(() => t('router.create_social_task')),
            noCache: true,
            activeMenu: '/socialtask/create',
          }
        },
        {
          path: 'list/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtask.vue'),
          name: 'SocialtaskList',
          meta: {
            title: computed(() => t('router.social_task_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'run/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrun.vue'),
          name: 'Runtask',
          meta: {
            title: computed(() => t('router.run_task')),
            icon: 'mdi-play-circle'
          }
        },
        {
          path: 'taskrunlist/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrunlist.vue'),
          name: 'Task-run-list',
          meta: {
            title: computed(() => t('router.task_run_list')),
            icon: 'mdi-playlist-play'
          }
        },
        {
          path: 'taskresultlist/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskresultlist.vue'),
          name: 'Task-result-list',
          meta: {
            title: computed(() => t('router.task_result_list')),
            icon: 'mdi-chart-line'
          }
        }
      ]
    },
    {
      path: '/socialaccount',
      name: 'Socialaccount',
      meta: {
        visible: true,
        title: computed(() => t('router.social_account')),
        icon: 'mdi-account-multiple'
      },
      component: Layout,
      children: [
        {
          path: 'list',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccount.vue'),
          name: 'SocialAccount',
          meta: {
            visible: true,
            title: computed(() => t('router.account_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
          name: 'editSocialAccount',
          meta: {
            visible: false,
            title: computed(() => t('router.edit_account')),
            icon: 'mdi-account-edit'
          }
        },
        {
          path: 'add',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
          name: 'CreateSocialAccount',
          meta: {
            visible: false,
            title: computed(() => t('router.add_account')),
            icon: 'mdi-account-plus'
          }
        },
      ]
    },
    {
      path: '/schedule',
      name: 'schedule',
      meta: {
        visible: true,
        title: computed(() => t('router.schedule')),
        icon: 'mdi-clock-outline'
      },
      component: Layout,
      children: [
        {
          path: 'list',
          component: () => import('@/views/pages/schedule/list.vue'),
          name: 'ScheduleList',
          meta: {
            visible: true,
            title: computed(() => t('router.schedule_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'create',
          component: () => import('@/views/pages/schedule/create.vue'),
          name: 'CreateSchedule',
          meta: {
            visible: false,
            title: computed(() => t('router.create_schedule')),
            icon: 'mdi-plus'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import('@/views/pages/schedule/edit.vue'),
          name: 'EditSchedule',
          meta: {
            visible: false,
            title: computed(() => t('router.edit_schedule')),
            icon: 'mdi-pencil'
          }
        },
        {
          path: 'detail/:id(\\d+)',
          component: () => import('@/views/pages/schedule/detail.vue'),
          name: 'ScheduleDetail',
          meta: {
            visible: false,
            title: computed(() => t('router.schedule_detail')),
            icon: 'mdi-file-document-outline'
          }
        }
      ]
    },
    {
      path: '/proxy',
      name: 'Proxy',
      meta: {
        visible: true,
        title: computed(() => t('router.proxy')),
        icon: 'mdi-shield-outline'
      },
      component: Layout, 
      children: [
        {
          path: 'list',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/proxy/proxy.vue'),
          name: 'Proxylist',
          meta: {
            visible: true,
            title: computed(() => t('router.proxy_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import('@/views/pages/proxy/proxydetail.vue'),
          name: 'editProxy',
          meta: {
            visible: false,
            title: computed(() => t('router.edit_proxy')),
            icon: 'mdi-pencil'
          }
        },
        {
          path: 'add',
          component: () => import('@/views/pages/proxy/proxydetail.vue'),
          name: 'AddProxy',
          meta: {
            visible: false,
            title: computed(() => t('router.add_proxy')),
            icon: 'mdi-plus'
          }
        },
        {
          path: 'parse',
          component: () => import('@/views/pages/proxy/proxyparse.vue'),
          name: 'ParseProxy',
          meta: {
            visible: true,
            title: computed(() => t('router.parse_proxy')),
            icon: 'mdi-code-braces'
          }
        }
      ]
    },
    {
      path: '/search',
      name: 'Search',
      meta: {
        visible: true,
        title: computed(() => t('router.search')),
        icon: 'mdi-magnify'
      },
      component: Layout, 
      children: [
        {
          path: 'form',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/index.vue'),
          name: 'Searchform',
          meta: {
            visible: true,
            title: computed(() => t('router.search_scraper')),
            icon: 'mdi-web'
          }
        },
        {
          path: 'tasklist',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/resultlist.vue'),
          name: 'Searchtasklist',
          meta: {
            visible: true,
            title: computed(() => t('router.search_task_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'taskdetail/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/detaillist.vue'),
          name: 'Searchtaskdetail',
          meta: {
            visible: false,
            title: computed(() => t('router.search_task_detail')),
            icon: 'mdi-file-document-outline'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/index.vue'),
          name: 'EditSearchTask',
          meta: {
            visible: false,
            title: computed(() => t('router.edit_search_task')),
            icon: 'mdi-pencil'
          }
        }
      ]
    },
    {
      path: '/emailextraction',
      name: 'Email_Extraction',
      meta: {
        visible: true,
        title: computed(() => t('router.email_extraction')),
        icon: 'mdi-email-search'
      },
      component: Layout, 
      children: [
        {
          path: 'form',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/index.vue'),
          name: 'Email_Extraction_Form',
          meta: {
            visible: true,
            title: computed(() => t('router.email_extraction_form')),
            icon: 'mdi-form-select'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/index.vue'),
          name: 'Email_Extraction_Edit',
          meta: {
            visible: false,
            title: computed(() => t('router.email_extraction_edit')),
            icon: 'mdi-pencil'
          }
        },
        {
          path: 'tasklist',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/resultlist.vue'),
          name: 'Email_Extraction_list',
          meta: {
            visible: true,
            title: computed(() => t('router.email_extraction_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'taskdetail/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/detaillist.vue'),
          name: 'Email_Extraction_Task_Detail',
          meta: {
            visible: false,
            title: computed(() => t('router.email_extraction_detail')),
            icon: 'mdi-file-document-outline'
          }
        }
      ]
    },
    {
      path: '/yellowpages',
      name: 'Yellow_Pages',
      meta: {
        visible: true,
        title: computed(() => t('router.yellow_pages')),
        icon: 'mdi-database-search'
      },
      component: Layout, 
      children: [
        {
          path: 'list',
          component: () => import('@/views/pages/yellowpages/list.vue'),
          name: 'YellowPagesList',
          meta: {
            visible: true,
            title: computed(() => t('router.yellow_pages_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'create',
          component: () => import('@/views/pages/yellowpages/create.vue'),
          name: 'CreateYellowPagesTask',
          meta: {
            visible: false,
            title: computed(() => t('router.create_yellow_pages_task')),
            icon: 'mdi-plus'
          }
        },
        {
          path: 'edit/:id(\\d+)',
          component: () => import('@/views/pages/yellowpages/create.vue'),
          name: 'EditYellowPagesTask',
          meta: {
            visible: false,
            title: computed(() => t('router.edit_yellow_pages_task')),
            icon: 'mdi-pencil'
          }
        },
        {
          path: 'detail/:id(\\d+)',
          component: () => import('@/views/pages/yellowpages/create.vue'),
          name: 'YellowPagesTaskDetail',
          meta: {
            visible: false,
            title: computed(() => t('router.yellow_pages_task_detail')),
            icon: 'mdi-file-document-outline'
          }
        },
        {
          path: 'results/:id(\\d+)',
          component: () => import('@/views/pages/yellowpages/results.vue'),
          name: 'YellowPagesResults',
          meta: {
            visible: false,
            title: computed(() => t('router.yellow_pages_results')),
            icon: 'mdi-chart-bar'
          }
        }
      ]
    },
    {
      path: '/emailmarketing',
      name: 'Email_Marketing',
      meta: {
        visible: true,
        title: computed(() => t('router.email_marketing')),
        icon: 'mdi-email-multiple'
      },
      component: Layout, 
      children: [
        {
          path: 'buckemailtask/list/',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailsendtask/list.vue'),
          name: 'BUCK_Email_TASK_LIST',
          meta: {
            visible: true,
            title: computed(() => t('router.bulk_email_task_list')),
            icon: 'mdi-format-list-bulleted'
          }
        },
        {
          path: 'buckemailtask/list/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailSendTaskLog/list.vue'),
          name: 'BUCK_Email_TASK_LOG_LIST',
          meta: {
            visible: false,
            title: computed(() => t('router.email_send_log')),
            icon: 'mdi-file-document-multiple'
          }
        },
        {
          path: 'form',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/buckemailform.vue'),
          name: 'Email_BUCK_SEND',
          meta: {
            visible: false,
            title: computed(() => t('router.sending_bulk_emails')),
            icon: 'mdi-email-send'
          }
        },
        {
          path: 'template/list/',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatelist.vue'),
          name: 'Email_Marketing_Template_List',
          meta: {
            visible: true,
            title: computed(() => t('router.email_template')),
            icon: 'mdi-file-document-edit'
          }
        },
        {
          path: 'template/detail/:id(\\d+)',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
          name: 'Email_Marketing_Template_Detail',
          meta: {
            visible: false,
            title: computed(() => t('router.email_template_detail')),
            icon: 'mdi-file-document-outline'
          }
        },
        {
          path: 'template/create',
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
          name: 'Email_Marketing_Template_Create',
          meta: {
            visible: false,
            title: computed(() => t('router.create_email_template')),
            icon: 'mdi-plus'
          }
        },
        {
          path: 'emailfilter/list',
          name: 'Email_Marketing_Filter_LIST',
          meta: {
            visible: true,
            title: computed(() => t('router.email_filter')),
            icon: 'mdi-filter'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/list.vue'),
        },
        {
          path: 'emailfilter/create',
          name: 'Email_Marketing_Filter_Create',
          meta: {
            visible: false,
            title: computed(() => t('router.email_filter_create')),
            icon: 'mdi-plus'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        },
        {
          path: 'emailfilter/detail/:id(\\d+)',
          name: 'Email_Marketing_Filter_Detail',
          meta: {
            visible: false,
            title: computed(() => t('router.email_filter_edit')),
            icon: 'mdi-pencil'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        },
        {
          path: 'emailservice/list',
          name: 'Email_Marketing_Service_LIST',
          meta: {
            visible: true,
            title: computed(() => t('router.email_service')),
            icon: 'mdi-email-sync'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/list.vue'),
        },
        {
          path: 'emailservice/create',
          name: 'Email_Marketing_Service_Create',
          meta: {
            visible: false,
            title: computed(() => t('router.email_service_create')),
            icon: 'mdi-plus'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/servicedetail.vue'),
        },
        {
          path: 'emailservice/detail/:id(\\d+)',
          name: 'Email_Marketing_Service_Detail',
          meta: {
            visible: false,
            title: computed(() => t('router.email_service_edit')),
            icon: 'mdi-pencil'
          },
          component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/servicedetail.vue'),
        },
      ]
    },
    {
      path: '/login',
      name: 'login',
      meta: {
        title: computed(() => t('router.login')),
        icon: 'mdi-shield-account',
        visible: false,
      },
      component: () => import('@/views/pages/login/login.vue'),
    },
    { path: '/:pathMatch(.*)', name: 'Match', meta: { keepAlive: false }, redirect: '/404' },
    {
      path: '/404',
      name: '404',
      meta: { 
        keepAlive: false, 
        title: computed(() => t('router.not_found')), 
        icon: 'mdi-alert-circle-outline', 
        visible: false 
      },
      component: Layout,
      children: [
        {
          path: '',
          name: 'd404',
          meta: {
            title: computed(() => t('router.not_found')),
            visible: false,
          },
          component: () => import('@/views/feedback/no.vue'),
          children: [],
        },
      ],
    },
  ];
};



