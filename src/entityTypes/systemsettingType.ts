export interface SystemSettingDisplay {
    id: number;
    key: string;          // e.g. 'site_name'
    value: string|null;        // stored value
    description?: string; // optional description
    group_id?: number;    // reference to setting group
    type: 'input' | 'select' | 'radio' | 'checkbox'|'file';  // new field for input type
    options?: OptionSettingDisplay[];   // optional list of choices for select/radio
    label?: string;       // optional label for checkbox
  }
  
  export interface SystemSettingGroupDisplay {
    id: number;
    parentId?: number; 
    name: string;
    description?: string;
    items: SystemSettingDisplay[];
  }
  export interface OptionSettingDisplay{
    id:number;
    optionValue: string;
    optionLabel: string;
  }
  export type SystemSettingGroupdf={
    name: string;
    description?: string;
    items: SystemSettingdf[];
  }
 export type SystemSettingdf={
    key: string;          // e.g. 'site_name'
    value: string;        // stored value
    description?: string; // optional description
    type: 'input' | 'select' | 'radio' | 'checkbox'|'toggle'|'file';  
    options?: OptionSettingdf[];
  }
  export type OptionSettingdf={
    optionValue: string;
    optionLabel: string; 
  }
  export type SetttingUpdate={
    id:number,
    value:string|null
  }
 