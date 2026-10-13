function registerCategoryHandlers({ ipcMain, getDatabase, administrator }) {
  function handle(channel, action) {
    ipcMain.handle(channel,(event,input) => {
      const user=administrator(event);
      if (!user) throw new Error('SESSION_EXPIRED: Please sign in to manage vehicle categories.');
      return action(getDatabase(),input,user);
    });
  }
  function id(value) { if (!Number.isSafeInteger(value) || value<1) throw new Error('Invalid vehicle category ID.'); return value; }
  function name(value) {
    if (typeof value!=='string' || !value.trim() || value.length>120 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a category name up to 120 characters.');
    return value.trim().replace(/ +/g,' ');
  }
  const read=(db,categoryId) => {
    const category=db.prepare('SELECT id,name,description,is_active AS isActive FROM vehicle_category_catalog WHERE id=?').get(categoryId);
    if (!category) throw new Error('Vehicle category does not exist.');
    return category;
  };
  function audit(db,user,action,categoryId) { db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id) VALUES(?,?,?,?)').run(user.id,action,'vehicle_category',categoryId); }
  handle('vehicle-types:get',db => db.prepare('SELECT id,name,description,is_active AS isActive FROM vehicle_category_catalog ORDER BY name COLLATE NOCASE,id').all());
  handle('vehicle-types:add',(db,input,user) => db.transaction(() => {
    const categoryId=Number(db.prepare('INSERT INTO vehicle_types(name) VALUES(?)').run(name(input?.name)).lastInsertRowid);
    audit(db,user,'category_created',categoryId); return read(db,categoryId);
  })());
  handle('vehicle-types:update',(db,input,user) => db.transaction(() => {
    const categoryId=id(input?.id); read(db,categoryId);
    db.prepare('UPDATE vehicle_types SET name=? WHERE id=?').run(name(input?.name),categoryId);
    db.prepare('UPDATE vehicle_type_state SET updated_at=CURRENT_TIMESTAMP WHERE vehicle_type_id=?').run(categoryId);
    audit(db,user,'category_renamed',categoryId); return read(db,categoryId);
  })());
  handle('vehicle-types:status',(db,input,user) => db.transaction(() => {
    const categoryId=id(input?.id); read(db,categoryId);
    if (typeof input?.isActive!=='boolean') throw new Error('Category status must be active or inactive.');
    db.prepare('UPDATE vehicle_type_state SET is_active=?,updated_at=CURRENT_TIMESTAMP WHERE vehicle_type_id=?').run(input.isActive?1:0,categoryId);
    audit(db,user,input.isActive?'category_activated':'category_deactivated',categoryId); return read(db,categoryId);
  })());
}
module.exports={ registerCategoryHandlers };
