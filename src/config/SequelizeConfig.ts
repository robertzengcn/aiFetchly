// import { Sequelize } from 'sequelize';

// export class SequelizeConfig {
//     private static instance: Sequelize;
//     private constructor(filepath:string) {
//         SequelizeConfig.getInstance(filepath);
//     }

//     public static getInstance(filepath:string): Sequelize {
//         if (!SequelizeConfig.instance) {
//             SequelizeConfig.instance = new Sequelize({
//                 dialect: 'sqlite',
//                 storage: filepath,
//                 logging: true,
//             });
//         }
//         return SequelizeConfig.instance;
//     }
// }