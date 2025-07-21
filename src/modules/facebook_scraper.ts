'use strict';
// import {cheerio} from 'cheerio';
import { SocialScraper as Scraper,ScrapeOptions} from './socialScraper';

export class FacebookScraper extends Scraper {

    constructor(args: ScrapeOptions) {
        super(args);
    }
 

    async load_login_page():Promise<void> {
        const startUrl = 'https://www.facebook.com';

        // if (this.config.facebook_settings) {
        //     startUrl = `https://www.${this.config.facebook_settings.facebook_domain}`;
        //     if (this.config.facebook_settings.facebook_domain) {
        //         startUrl = `https://www.${this.config.facebook_settings.facebook_domain}`;
        //     } else {
        //         startUrl = `https://www.facebook.com`;
        //     }

        //     for (var key in this.config.facebook_settings) {
        //         if (key !== 'facebook_domain') {
        //             startUrl += `${key}=${this.config.facebook_settings[key]}&`
        //         }
        //     }
        // }

        this.logger.info('Using loginUrl: ' + startUrl);

        this.last_response = await this.page.goto(startUrl);

        //await this.page.waitForSelector('input[name="q"]', { timeout: this.STANDARD_TIMEOUT });

        // return true;
    }
    //user login by hand
    async userloginaction(){

    }

}


