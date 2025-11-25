import { createRouter, createWebHashHistory } from 'vue-router';
import Layout from '@/views/layout/layout.vue';
import { RouteRecordRaw } from 'vue-router';
// import { checkVersion } from '@/plugins/pwa';

export const constantRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard/home',
    name: 'Dashboard',
    meta: {
      visible: false,
      title: 'route.dashboard',
      icon: 'mdi-view-dashboard',
    },
    component: Layout,
    children: [

      {
        path: '/dashboard/home',
        name: 'home',
          meta: {
              title: 'route.home',
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
      title: 'route.system_setting',
      icon: 'mdi-cog',
    },
    component: Layout,
    children: [
      {
        path: 'index',
        name: 'system_setting_index',
          meta: {
              title: 'route.system_setting',
              icon: 'mdi-cog-outline',
              keepAlive: false,
              visible: true,
          },
          component: () => import('@/views/pages/systemsetting/index.vue'),
          children: [],
      },
      {
        path: 'mcp',
        name: 'system_setting_mcp',
          meta: {
              title: 'route.mcp_tools',
              icon: 'mdi-toolbox',
              keepAlive: false,
              visible: false,
          },
          component: () => import('@/views/pages/systemsetting/mcp.vue'),
          children: [],
      }
    ],
  },

  {
    path: '/campaign',
    name: 'campaign',
    meta: {
      visible: false,
      title: 'route.campaign',
      icon: 'mdi-bullhorn',
    },
    component: Layout,
    children: [
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/campaign/campaign.vue'),
        name: 'EditCampaign',
        meta: {
          title: 'route.edit_campaign',
          noCache: true,
          activeMenu: '/campaign/list',
          // hidden: true
        }
      },
      {
        path: 'list',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/campaign/campaign.vue'),
        name: 'CampaignList',
        meta: {
          visible: true,
          title: 'route.campaign_list',
          icon: 'mdi-format-list-bulleted'
        }
      }
    ]
  },
  {
    path: '/socialtask',
    name: 'socialtask',
    meta: {
      // visible: true,
      title: 'route.social_task',
      icon: 'mdi-account-group',
    },
    component: Layout,
    children: [
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/socialtask/socialtaskdetail.vue'),
        name: 'EditSocialtask',
        meta: {
          title: 'route.edit_social_task',
          noCache: true,
          activeMenu: '/socialtask/edit',
          // hidden: true
        }
      },
      {
        path: 'create/:campaignId(\\d+)',
        component: () => import(/* webpackChunkName: "socialtaskdetail" */ '@/views/pages/socialtask/socialtaskdetail.vue'),
        name: 'CreateSocialtask',
        meta: {

          title: 'route.create_social_task',
          noCache: true,
          activeMenu: '/socialtask/create',
          //   hidden: true
        }
      },
      {
        path: 'list/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtask.vue'),
        name: 'SocialtaskList',
        meta: {
          title: 'route.social_task_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'run/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrun.vue'),
        name: 'Runtask',
        meta: {
          title: 'route.run_task',
          icon: 'mdi-play-circle'
        }
      }, {
        path: 'taskrunlist/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrunlist.vue'),
        name: 'Task-run-list',
        meta: {
          title: 'route.task_run_list',
          icon: 'mdi-playlist-play'
        }
      },
      {
        path: 'taskresultlist/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskresultlist.vue'),
        name: 'Task-result-list',
        meta: {
          title: 'route.task_result_list',
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
      title: 'route.social_account',
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
          title: 'route.account_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
        name: 'editSocialAccount',
        meta: {
          visible: false,
          title: 'route.edit_account',
          icon: 'mdi-account-edit'
        }
      },
      {
        path: 'add',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
        name: 'CreateSocialAccount',
        meta: {
          visible: false,
          title: 'route.add_account',
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
      title: 'route.schedule',
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
          title: 'route.schedule_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'create',
        component: () => import('@/views/pages/schedule/create.vue'),
        name: 'CreateSchedule',
        meta: {
          visible: false,
          title: 'route.create_schedule',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/schedule/edit.vue'),
        name: 'EditSchedule',
        meta: {
          visible: false,
          title: 'route.edit_schedule',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'detail/:id(\\d+)',
        component: () => import('@/views/pages/schedule/detail.vue'),
        name: 'ScheduleDetail',
        meta: {
          visible: false,
          title: 'route.schedule_detail',
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
      title: 'route.proxy',
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
          title: 'route.proxy_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/proxy/proxydetail.vue'),
        name: 'editProxy',
        meta: {
          visible: false,
          title: 'route.edit_proxy',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'add',
        component: () => import('@/views/pages/proxy/proxydetail.vue'),
        name: 'AddProxy',
        meta: {
          visible: false,
          title: 'route.add_proxy',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'parse',
        component: () => import('@/views/pages/proxy/proxyparse.vue'),
        name: 'BatchUploadProxy',
        meta: {
          visible: true,
          title: 'route.parse_proxy',
          icon: 'mdi-upload-multiple'
        }
      }
    ]
  },
  // {
  //   path: '/extramodules',
  //   name: 'Modules',
  //   meta: {
  //     visible: true,
  //     title: 'Modules',
  //     icon: 'mdi-paw-off'
  //   },
  //   component: Layout, 
  //   children: [
  //     {
  //       path: 'list',
  //       component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/extramodules/extramoduleslist.vue'),
  //       name: 'Moduleslist',
  //       meta: {
  //         visible: true,
  //         title: 'Modules List',
  //         icon: 'list'
  //       }
  //     }
  //   ]
  // },
  {
    path: '/search',
    name: 'Search',
    meta: {
      visible: true,
      title: 'route.search',
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
          title: 'route.search_scraper',
          icon: 'mdi-web'
        }
      },
      {
        path: 'tasklist',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/resultlist.vue'),
        name: 'Searchtasklist',
        meta: {
          visible: true,
          title: 'route.search_task_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'taskdetail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/detaillist.vue'),
        name: 'Searchtaskdetail',
        meta: {
          visible: false,
          title: 'route.search_task_detail',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/index.vue'),
        name: 'EditSearchTask',
        meta: {
          visible: false,
          title: 'route.edit_search_task',
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
      title: 'route.email_extraction',
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
          title: 'route.email_extraction_form',
          icon: 'mdi-form-select'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/index.vue'),
        name: 'Email_Extraction_Edit',
        meta: {
          visible: false,
          title: 'route.email_extraction_edit',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'tasklist',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/resultlist.vue'),
        name: 'Email_Extraction_list',
        meta: {
          visible: true,
          title: 'route.email_extraction_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'taskdetail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/detaillist.vue'),
        name: 'Email_Extraction_Task_Detail',
        meta: {
          visible: false,
          title: 'route.email_extraction_detail',
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
      title: 'route.yellow_pages',
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
          title: 'route.yellow_pages_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'create',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'CreateYellowPagesTask',
        meta: {
          visible: false,
          title: 'route.create_yellow_pages_task',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'EditYellowPagesTask',
        meta: {
          visible: false,
          title: 'route.edit_yellow_pages_task',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'detail/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'YellowPagesTaskDetail',
        meta: {
          visible: false,
          title: 'route.yellow_pages_task_detail',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'results/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/results.vue'),
        name: 'YellowPagesResults',
        meta: {
          visible: false,
          title: 'route.yellow_pages_results',
          icon: 'mdi-chart-bar'
        }
      }
    ]
  },
  {
    path: '/knowledge',
    name: 'Knowledge_Library',
    meta: {
      visible: true,
      title: 'route.knowledge_library',
      icon: 'mdi-book-open-variant'
    },
    component: Layout,
    children: [
      {
        path: 'library',
        component: () => import('@/views/pages/knowledge/KnowledgeLibrary.vue'),
        name: 'KnowledgeLibrary',
        meta: {
          visible: true,
          title: 'route.knowledge_library',
          icon: 'mdi-book-open-variant'
        }
      }
    ]
  },
  {
    path: '/emailmarketing',
    name: 'Email_Marketing',
    meta: {
      visible: true,
      title: 'route.email_marketing',
      icon: 'mdi-email-multiple'
    },
    component: Layout, 
    children: [
      {
        path: 'buckemailtask/list/',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailsendtask/list.vue'),
        name: 'BUCK_Email_TASK_LIST',
        meta:   {
          visible: true,
          title: 'route.bulk_email_task_list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'buckemailtask/list/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailSendTaskLog/list.vue'),
        name: 'BUCK_Email_TASK_LOG_LIST',
        meta:   {
          visible: false,
          title: 'route.email_send_log',
          icon: 'mdi-file-document-multiple'
        }
      },
      {
        path: 'form',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/buckemailform.vue'),
        name: 'Email_BUCK_SEND',
        meta: {
          visible: false,
          title: 'route.sending_bulk_emails',
          icon: 'mdi-email-send'
        }
      },
      {
        path: 'template/list/',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatelist.vue'),
        name: 'Email_Marketing_Template_List',
        meta: {
          visible: true,
          title: 'route.email_template',
          icon: 'mdi-file-document-edit'
        }
      },
      {
        path: 'template/detail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
        name: 'Email_Marketing_Template_Detail',
        meta: {
          visible: false,
          title: 'route.email_template_detail',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'template/create',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
        name: 'Email_Marketing_Template_Create',
        meta: {
          visible: false,
          title: 'route.create_email_template',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'emailfilter/list',
        name: 'Email_Marketing_Filter_LIST',
        meta: {
          visible: true,
          title: 'route.email_filter',
          icon: 'mdi-filter'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/list.vue'),
        
      },
      {
        path: 'emailfilter/create',
        name: 'Email_Marketing_Filter_Create',
        meta: {
          visible: false,
          title: 'route.email_filter_create',
          icon: 'mdi-plus'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        
      },
      {
        path: 'emailfilter/detail/:id(\\d+)',
        name: 'Email_Marketing_Filter_Detail',
        meta: {
          visible: false,
          title: 'route.email_filter_edit',
          icon: 'mdi-pencil'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        
      },
      {
        path: 'emailservice/list',
        name: 'Email_Marketing_Service_LIST',
        meta: {
          visible: true,
          title: 'route.email_service',
          icon: 'mdi-email-sync'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/list.vue'),
        
      },
      {
        path: 'emailservice/create',
        name: 'Email_Marketing_Service_Create',
        meta: {
          visible: false,
          title: 'route.email_service_create',
          icon: 'mdi-plus'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/servicedetail.vue'),
        
      },
      {
        path: 'emailservice/detail/:id(\\d+)',
        name: 'Email_Marketing_Service_Detail',
        meta: {
          visible: false,
          title: 'route.email_service_edit',
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
      title: 'route.login',
      icon: 'mdi-shield-account',
      visible: false,
    },
    component: () => import('@/views/pages/login/login.vue'),
  },
  { path: '/:pathMatch(.*)', name: 'Match', meta: { keepAlive: false }, redirect: '/404' },
  {
    path: '/404',
    name: '404',
    meta: { keepAlive: false, title: 'route.not_found', icon: 'mdi-alert-circle-outline', visible: false },
    component: Layout,
    children: [
      {
        path: '',
        name: 'd404',
        meta: {
          title: 'route.not_found',
          visible: false,
        },
        component: () => import('@/views/feedback/no.vue'),
        children: [],
      },
    ],
  },
  
];


// route.beforeEach(async (to, _from, next) => {
//     next();
// });

// route.afterEach(() => {
//     checkVersion();
// });


/**
 * asyncRoutes
 * the routes that need to be dynamically loaded based on user roles
*/
export const asyncRoutes: RouteRecordRaw[] = [];

const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior() {
    return { top: 0 };
  },
  routes: constantRoutes
});


export default router;

