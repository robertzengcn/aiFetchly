"use strict";
export {};
import {VideoInfo} from './socialScraper';

/**
 * The Subject interface declares a set of methods for managing subscribers.
 */
export interface Subject {
    // Attach an observer to the subject.
    attach(observer: Observer): void;

    // Detach an observer from the subject.
    detach(observer: Observer): void;

    // Notify all observers about an event.
    notify(...args): void;
}

/**
 * The Observer interface declares the update method, used by subjects.
 */
export interface Observer {
    update(type:string,data:VideoInfo|any): void;
    //update(type:string,data:any): void;
    //update(type:string,data:string): void;
    
}