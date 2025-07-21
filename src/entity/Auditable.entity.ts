import "reflect-metadata"
import { BaseEntity, Column, DataSource } from 'typeorm';
import { Order, getOrder } from '@/entity/order.decorator'
export default abstract class AuditableEntity extends BaseEntity {
    @Order(9999)
    @Column('datetime', {
      default: () => 'CURRENT_TIMESTAMP',
      nullable: true
    })
    createdAt?: Date;
    @Order(9999)
    @Column('datetime', {
      default: () => 'CURRENT_TIMESTAMP',
      onUpdate: 'CURRENT_TIMESTAMP',
      nullable: true,
      
    })
    updatedAt?: Date;
    static useDataSource(dataSource: DataSource) {
      BaseEntity.useDataSource.call(this, dataSource)
      const meta = dataSource.entityMetadatasMap.get(this)
     
      const getOrderSafely = (column) => {
        const target = column.target as any;
  
        // Check if the target and its prototype exist
        if (target && target.prototype) {
          // Retrieve the column order using the custom getColumnOrder function
          return getOrder(target.prototype, column.propertyName);
        }
  
        // Fallback to a default high order value if target is undefined
        return 9996;
      };
      if (meta != null) {
          // reorder columns here
          meta.columns = [...meta.columns].sort((x, y) => {
              const orderX = getOrderSafely(x)
              const orderY = getOrderSafely(y)
              return orderX - orderY
          })
      }
  }
  }