-- Only category/service names supplied by the business. No prices or sample visits.
WITH requested(name) AS (VALUES
  ('Private Sln / Taxi'),('4x4 / Pickup'),('CRV - RAV4 - HRV'),('Motor'),('Motor King'),('Okada'),('Urvan'),('Sprinter'),('Coaster Bus'),('VIP - OA (Bus)'),
  ('Bullion Van'),('Towing Car'),('Kia Sm'),('Kia Mini'),('Kia Rhino'),('Truck Head'),('Timber'),
  ('Dump / Tipper Truck 1'),('Dump / Tipper Truck 2'),('Dump / Tipper Truck 3'),('Dump / Tipper Truck 4'),('Back Hoe'),('Loader'),
  ('Long Vehicle (Flat)'),('Long Vehicle (H/B)'),('Long Vehicle (F/B)'),('Low Bed 1'),('Low Bed 2'),('Grader'),('Dozer 1'),('Dozer 2'),('Excavator 1'),('Excavator 2'),
  ('Tanker 1'),('Tanker 2'),('Tanker 3'),('Paver Machine Truck'),
  ('Close Body Container Truck 1'),('Close Body Container Truck 2'),('Close Body Container Truck 3'),('Close Body Container Truck 4'),('Close Body Container Truck 5'),('Close Body Container Truck 6')
)
INSERT INTO vehicle_types(name) SELECT r.name FROM requested r
  WHERE NOT EXISTS(SELECT 1 FROM vehicle_category_presets WHERE preset_name=r.name)
    AND NOT EXISTS(SELECT 1 FROM vehicle_types WHERE lower(replace(replace(name,' ',''),'×','x'))=lower(replace(replace(r.name,' ',''),'×','x')));

WITH requested(name) AS (VALUES
  ('Private Sln / Taxi'),('4x4 / Pickup'),('CRV - RAV4 - HRV'),('Motor'),('Motor King'),('Okada'),('Urvan'),('Sprinter'),('Coaster Bus'),('VIP - OA (Bus)'),
  ('Bullion Van'),('Towing Car'),('Kia Sm'),('Kia Mini'),('Kia Rhino'),('Truck Head'),('Timber'),
  ('Dump / Tipper Truck 1'),('Dump / Tipper Truck 2'),('Dump / Tipper Truck 3'),('Dump / Tipper Truck 4'),('Back Hoe'),('Loader'),
  ('Long Vehicle (Flat)'),('Long Vehicle (H/B)'),('Long Vehicle (F/B)'),('Low Bed 1'),('Low Bed 2'),('Grader'),('Dozer 1'),('Dozer 2'),('Excavator 1'),('Excavator 2'),
  ('Tanker 1'),('Tanker 2'),('Tanker 3'),('Paver Machine Truck'),
  ('Close Body Container Truck 1'),('Close Body Container Truck 2'),('Close Body Container Truck 3'),('Close Body Container Truck 4'),('Close Body Container Truck 5'),('Close Body Container Truck 6')
)
INSERT OR IGNORE INTO vehicle_category_presets(preset_name,vehicle_type_id)
  SELECT r.name,(SELECT id FROM vehicle_types WHERE lower(replace(replace(name,' ',''),'×','x'))=lower(replace(replace(r.name,' ',''),'×','x')) ORDER BY id LIMIT 1)
  FROM requested r WHERE NOT EXISTS(SELECT 1 FROM vehicle_category_presets WHERE preset_name=r.name);

-- Reuse existing service classifications, including legacy Washing/Blowing names.
INSERT INTO services(name) SELECT 'Wash' WHERE NOT EXISTS(SELECT 1 FROM service_definitions WHERE kind='washing');
INSERT INTO services(name) SELECT 'Blow' WHERE NOT EXISTS(SELECT 1 FROM service_definitions WHERE kind='blowing');
INSERT INTO services(name) SELECT 'Engine Wash' WHERE NOT EXISTS(SELECT 1 FROM service_roles WHERE code='engine_wash');
INSERT INTO services(name) SELECT 'Under Wash' WHERE NOT EXISTS(SELECT 1 FROM service_roles WHERE code='under_wash');
