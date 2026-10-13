export type BusinessPreferences={dateFormat:'long'|'iso'|'day_first';startPage:'overview'|'visits'|'reports'};
export type SettingsData={business:{businessName:string;phone:string|null;address:string|null;email:string|null;currency:string;taxRate:number};preferences:BusinessPreferences;user:import('./app-api').Administrator;appVersion:string;logoDataUrl:string|null;logoWarning:string;databaseLocation:string|null;defaultBackupLocation:string|null};
export type BusinessSettingsInput={businessName:string;phone:string;address:string;email:string;currency:string;dateFormat:BusinessPreferences['dateFormat'];startPage:BusinessPreferences['startPage'];logoAction:'keep'|'replace'|'remove';logo?:{mimeType:string;bytes:Uint8Array}};
export type BackupRecord={kind:'manual'|'safety'|'restore';folder:string;filename?:string;createdAt:string;businessName?:string;verified:boolean;safetyBackup?:string;warning?:string};
export type BackupResult={canceled:true}|({canceled:false}&BackupRecord);
export type BackupVerification={canceled:true}|{canceled:false;businessName:string;createdAt:string;appVersion:string;location:string;verified:true};
export type RestoreSelection={canceled:true}|{canceled:false;token:string;businessName:string;createdAt:string;appVersion:string;location:string;verified:true;expiresAt:string};
export type RestoreResult={canceled:true}|{canceled:false;success:true;businessName:string;safetyBackup:string;rollbackFile:string;restoredAt:string;signInRequired:true;warning?:string};
