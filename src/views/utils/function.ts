import {EmailTemplatePreviewdata,EmailTemplatedata} from "@/entityTypes/emailmarketingType"
//split array into groups
export function SplitArrayIntoGroups<Type>(array: Type[], groupSize: number):Type[][] {
        const groups:Type[][] = [];
        for (let i = 0; i < array.length; i += groupSize) {
            // array.slice(i, i + groupSize)
            groups.push(array.slice(i, i + groupSize));
        }
        return groups;
}

const StringIsNumber = value => isNaN(Number(value)) === false;
export function ToArray(enumme) {
    return Object.keys(enumme)
        .filter(StringIsNumber)
        .map(key => enumme[key]);
  }
export  function CapitalizeFirstLetter(string:string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}  
export function convertNumberToBoolean(num: number): boolean {
    return num !== 0;
  }
export function isValidUrl(url:string):boolean {
    try {
        new URL(url);
        return true;
      } catch (e) {
        return false;
      }
} 




