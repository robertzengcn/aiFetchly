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
      title: 'Dashboard',
      icon: 'mdi-view-dashboard',
    },
    component: Layout,
    children: [

      {
        path: '/dashboard/home',
        name: 'home',
          meta: {
              title: 'Home',
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
      title: 'System Setting',
      icon: 'mdi-cog',
    },
    component: Layout,
    children: [
      {
        path: 'index',
        name: 'system_setting_index',
          meta: {
              title: 'System Setting',
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
      title: 'Campaign',
      icon: 'mdi-bullhorn',
    },
    component: Layout,
    children: [
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/campaign/campaign.vue'),
        name: 'EditCampaign',
        meta: {
          title: 'editCampaign',
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
          title: 'campaignList',
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
      title: 'Social Task',
      icon: 'mdi-account-group',
    },
    component: Layout,
    children: [
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-edit" */ '@/views/pages/socialtask/socialtaskdetail.vue'),
        name: 'EditSocialtask',
        meta: {
          title: 'Edit Socialtask',
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

          title: 'Create Socialtask',
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
          title: 'socialtaskList',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'run/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrun.vue'),
        name: 'Runtask',
        meta: {
          title: 'Socialtask Run',
          icon: 'mdi-play-circle'
        }
      }, {
        path: 'taskrunlist/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskrunlist.vue'),
        name: 'Task-run-list',
        meta: {
          title: 'Social task Run List',
          icon: 'mdi-playlist-play'
        }
      },
      {
        path: 'taskresultlist/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialtask/socialtaskresultlist.vue'),
        name: 'Task-result-list',
        meta: {
          title: 'Social task Result List',
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
      title: 'Social Account',
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
          title: 'Account List',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
        name: 'editSocialAccount',
        meta: {
          visible: false,
          title: 'Edit Account',
          icon: 'mdi-account-edit'
        }
      },
      {
        path: 'add',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/socialaccount/socialaccountdetail.vue'),
        name: 'CreateSocialAccount',
        meta: {
          visible: false,
          title: 'Add Account',
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
      title: 'Schedule',
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
          title: 'Schedule List',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'create',
        component: () => import('@/views/pages/schedule/create.vue'),
        name: 'CreateSchedule',
        meta: {
          visible: false,
          title: 'Create Schedule',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/schedule/edit.vue'),
        name: 'EditSchedule',
        meta: {
          visible: false,
          title: 'Edit Schedule',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'detail/:id(\\d+)',
        component: () => import('@/views/pages/schedule/detail.vue'),
        name: 'ScheduleDetail',
        meta: {
          visible: false,
          title: 'Schedule Detail',
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
      title: 'Proxy',
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
          title: 'Proxy List',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/proxy/proxydetail.vue'),
        name: 'editProxy',
        meta: {
          visible: false,
          title: 'Edit Proxy',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'add',
        component: () => import('@/views/pages/proxy/proxydetail.vue'),
        name: 'AddProxy',
        meta: {
          visible: false,
          title: 'Add Proxy',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'parse',
        component: () => import('@/views/pages/proxy/proxyparse.vue'),
        name: 'ParseProxy',
        meta: {
          visible: true,
          title: 'Parse Proxy',
          icon: 'mdi-code-braces'
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
      title: 'Search',
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
          title: 'Search Scraper',
          icon: 'mdi-web'
        }
      },
      {
        path: 'tasklist',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/resultlist.vue'),
        name: 'Searchtasklist',
        meta: {
          visible: true,
          title: 'Search Task list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'taskdetail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/detaillist.vue'),
        name: 'Searchtaskdetail',
        meta: {
          visible: false,
          title: 'Search Task Detail',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/search/index.vue'),
        name: 'EditSearchTask',
        meta: {
          visible: false,
          title: 'Edit Search Task',
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
      title: 'Email Extraction',
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
          title: 'Email Extraction',
          icon: 'mdi-form-select'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/index.vue'),
        name: 'Email_Extraction_Edit',
        meta: {
          visible: false,
          title: 'Edit Email Extraction Task',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'tasklist',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/resultlist.vue'),
        name: 'Email_Extraction_list',
        meta: {
          visible: true,
          title: 'Email Extraction Task list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'taskdetail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailextraction/detaillist.vue'),
        name: 'Email_Extraction_Task_Detail',
        meta: {
          visible: false,
          title: 'Email Extraction Detail',
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
      title: 'Yellow Pages Scraper',
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
          title: 'Task List',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'create',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'CreateYellowPagesTask',
        meta: {
          visible: false,
          title: 'Create Task',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'edit/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'EditYellowPagesTask',
        meta: {
          visible: false,
          title: 'Edit Task',
          icon: 'mdi-pencil'
        }
      },
      {
        path: 'detail/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/create.vue'),
        name: 'YellowPagesTaskDetail',
        meta: {
          visible: false,
          title: 'Task Detail',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'results/:id(\\d+)',
        component: () => import('@/views/pages/yellowpages/results.vue'),
        name: 'YellowPagesResults',
        meta: {
          visible: false,
          title: 'Task Results',
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
      title: 'Email Marketing',
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
          title: 'Bulk email task list',
          icon: 'mdi-format-list-bulleted'
        }
      },
      {
        path: 'buckemailtask/list/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailSendTaskLog/list.vue'),
        name: 'BUCK_Email_TASK_LOG_LIST',
        meta:   {
          visible: false,
          title: 'email send log',
          icon: 'mdi-file-document-multiple'
        }
      },
      {
        path: 'form',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/buckemailform.vue'),
        name: 'Email_BUCK_SEND',
        meta: {
          visible: false,
          title: 'Sending bulk emails',
          icon: 'mdi-email-send'
        }
      },
      {
        path: 'template/list/',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatelist.vue'),
        name: 'Email_Marketing_Template_List',
        meta: {
          visible: true,
          title: 'Email Template',
          icon: 'mdi-file-document-edit'
        }
      },
      {
        path: 'template/detail/:id(\\d+)',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
        name: 'Email_Marketing_Template_Detail',
        meta: {
          visible: false,
          title: 'Email Template',
          icon: 'mdi-file-document-outline'
        }
      },
      {
        path: 'template/create',
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailmarketing/template/templatedetail.vue'),
        name: 'Email_Marketing_Template_Create',
        meta: {
          visible: false,
          title: 'Create Email Template',
          icon: 'mdi-plus'
        }
      },
      {
        path: 'emailfilter/list',
        name: 'Email_Marketing_Filter_LIST',
        meta: {
          visible: true,
          title: 'Email Filter',
          icon: 'mdi-filter'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/list.vue'),
        
      },
      {
        path: 'emailfilter/create',
        name: 'Email_Marketing_Filter_Create',
        meta: {
          visible: false,
          title: 'Email Filter Create',
          icon: 'mdi-plus'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        
      },
      {
        path: 'emailfilter/detail/:id(\\d+)',
        name: 'Email_Marketing_Filter_Detail',
        meta: {
          visible: false,
          title: 'Email Filter Edit',
          icon: 'mdi-pencil'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailfilter/filterdetail.vue'),
        
      },
      {
        path: 'emailservice/list',
        name: 'Email_Marketing_Service_LIST',
        meta: {
          visible: true,
          title: 'Email Service',
          icon: 'mdi-email-sync'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/list.vue'),
        
      },
      {
        path: 'emailservice/create',
        name: 'Email_Marketing_Service_Create',
        meta: {
          visible: false,
          title: 'Email Service Create',
          icon: 'mdi-plus'
        },
        component: () => import(/* webpackChunkName: "staff-list" */ '@/views/pages/emailservice/servicedetail.vue'),
        
      },
      {
        path: 'emailservice/detail/:id(\\d+)',
        name: 'Email_Marketing_Service_Detail',
        meta: {
          visible: false,
          title: 'Email Service Edit',
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
      title: 'Login',
      icon: 'mdi-shield-account',
      visible: false,
    },
    component: () => import('@/views/pages/login/login.vue'),
  },
  { path: '/:pathMatch(.*)', name: 'Match', meta: { keepAlive: false }, redirect: '/404' },
  {
    path: '/404',
    name: '404',
    meta: { keepAlive: false, title: 'Not found', icon: 'mdi-alert-circle-outline', visible: false },
    component: Layout,
    children: [
      {
        path: '',
        name: 'd404',
        meta: {
          title: 'Not found',
          visible: false,
        },
        component: () => import('@/views/feedback/no.vue'),
        children: [],
      },
    ],
  },
  
];


// router.beforeEach(async (to, _from, next) => {
//     next();
// });

// router.afterEach(() => {
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

