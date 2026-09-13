CREATE OR REPLACE FUNCTION public.crm_cemetery_api(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  cu public.users%ROWTYPE;
  v_page integer := greatest(coalesce(nullif(p_payload->>'page','')::integer,1),1);
  v_size integer := least(greatest(coalesce(nullif(p_payload->>'page_size','')::integer,60),1),200);
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
  v_id uuid;
  v_status text;
BEGIN
  SELECT u.* INTO cu
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1;
  IF cu.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.','code','UNAUTHENTICATED');
  END IF;

  IF p_action='summary' THEN
    RETURN jsonb_build_object(
      'ok',true,
      'summary',(SELECT jsonb_build_object(
        'total',count(*),
        'available',count(*) FILTER (WHERE sales_status='available'),
        'deposit',count(*) FILTER (WHERE sales_status='deposit'),
        'locked',count(*) FILTER (WHERE sales_status='locked'),
        'priced',count(*) FILTER (WHERE price_before_vat>0),
        'unpriced',count(*) FILTER (WHERE price_before_vat=0),
        'wholesale',count(*) FILTER (WHERE sale_mode='Bán sỉ'),
        'retail',count(*) FILTER (WHERE sale_mode='Bán lẻ'),
        'zones',count(DISTINCT cemetery_zone),
        'min_price',min(price_before_vat) FILTER (WHERE price_before_vat>0),
        'max_price',max(price_before_vat) FILTER (WHERE price_before_vat>0)
      ) FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên')
    );

  ELSIF p_action='facets' THEN
    RETURN jsonb_build_object(
      'ok',true,
      'zones',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT cemetery_zone x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND cemetery_zone IS NOT NULL) s),'[]'::jsonb),
      'subzones',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT cemetery_subzone x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND cemetery_subzone IS NOT NULL AND (nullif(p_payload->>'zone','') IS NULL OR cemetery_zone=p_payload->>'zone')) s),'[]'::jsonb),
      'rows',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT cemetery_row x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND cemetery_row IS NOT NULL AND (nullif(p_payload->>'subzone','') IS NULL OR cemetery_subzone=p_payload->>'subzone')) s),'[]'::jsonb),
      'orientations',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT orientation x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND orientation IS NOT NULL) s),'[]'::jsonb),
      'grave_classes',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT grave_class x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND grave_class IS NOT NULL) s),'[]'::jsonb),
      'sale_modes',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT sale_mode x FROM public.properties WHERE project='Thiên Phúc Vĩnh Hằng Viên' AND sale_mode IS NOT NULL) s),'[]'::jsonb)
    );

  ELSIF p_action='search' THEN
    v_offset := (v_page-1)*v_size;
    SELECT count(*) INTO v_total
    FROM public.properties p
    WHERE p.project='Thiên Phúc Vĩnh Hằng Viên'
      AND (nullif(trim(p_payload->>'query'),'') IS NULL OR p.code ILIKE '%'||trim(p_payload->>'query')||'%' OR p.name ILIKE '%'||trim(p_payload->>'query')||'%')
      AND (nullif(p_payload->>'zone','') IS NULL OR p.cemetery_zone=p_payload->>'zone')
      AND (nullif(p_payload->>'subzone','') IS NULL OR p.cemetery_subzone=p_payload->>'subzone')
      AND (nullif(p_payload->>'row','') IS NULL OR p.cemetery_row=p_payload->>'row')
      AND (nullif(p_payload->>'grave_class','') IS NULL OR p.grave_class=p_payload->>'grave_class')
      AND (nullif(p_payload->>'orientation','') IS NULL OR p.orientation=p_payload->>'orientation')
      AND (nullif(p_payload->>'sales_status','') IS NULL OR p.sales_status=p_payload->>'sales_status')
      AND (nullif(p_payload->>'sale_mode','') IS NULL OR p.sale_mode=p_payload->>'sale_mode')
      AND (nullif(p_payload->>'min_price','') IS NULL OR p.price_before_vat>=nullif(p_payload->>'min_price','')::numeric)
      AND (nullif(p_payload->>'max_price','') IS NULL OR p.price_before_vat<=nullif(p_payload->>'max_price','')::numeric)
      AND (coalesce((p_payload->>'priced_only')::boolean,false)=false OR p.price_before_vat>0);

    SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT p.id,p.code,p.name,p.property_type,p.area,p.price,p.price_before_vat,p.status,p.sales_status,p.sale_mode,
             p.cemetery_zone,p.cemetery_subzone,p.cemetery_row,p.grave_class,p.burial_capacity,p.orientation,
             p.source_status,p.source_sheet,p.source_row,p.notes,p.updated_at
      FROM public.properties p
      WHERE p.project='Thiên Phúc Vĩnh Hằng Viên'
        AND (nullif(trim(p_payload->>'query'),'') IS NULL OR p.code ILIKE '%'||trim(p_payload->>'query')||'%' OR p.name ILIKE '%'||trim(p_payload->>'query')||'%')
        AND (nullif(p_payload->>'zone','') IS NULL OR p.cemetery_zone=p_payload->>'zone')
        AND (nullif(p_payload->>'subzone','') IS NULL OR p.cemetery_subzone=p_payload->>'subzone')
        AND (nullif(p_payload->>'row','') IS NULL OR p.cemetery_row=p_payload->>'row')
        AND (nullif(p_payload->>'grave_class','') IS NULL OR p.grave_class=p_payload->>'grave_class')
        AND (nullif(p_payload->>'orientation','') IS NULL OR p.orientation=p_payload->>'orientation')
        AND (nullif(p_payload->>'sales_status','') IS NULL OR p.sales_status=p_payload->>'sales_status')
        AND (nullif(p_payload->>'sale_mode','') IS NULL OR p.sale_mode=p_payload->>'sale_mode')
        AND (nullif(p_payload->>'min_price','') IS NULL OR p.price_before_vat>=nullif(p_payload->>'min_price','')::numeric)
        AND (nullif(p_payload->>'max_price','') IS NULL OR p.price_before_vat<=nullif(p_payload->>'max_price','')::numeric)
        AND (coalesce((p_payload->>'priced_only')::boolean,false)=false OR p.price_before_vat>0)
      ORDER BY p.cemetery_zone,p.cemetery_subzone,p.cemetery_row,p.code
      LIMIT v_size OFFSET v_offset
    ) q;
    RETURN jsonb_build_object('ok',true,'rows',v_rows,'total',v_total,'page',v_page,'page_size',v_size,'pages',ceil(v_total::numeric/v_size)::integer);

  ELSIF p_action='detail' THEN
    RETURN jsonb_build_object('ok',true,'plot',(
      SELECT to_jsonb(q) FROM (
        SELECT p.id,p.code,p.name,p.project,p.property_type,p.area,p.price,p.price_before_vat,p.status,p.sales_status,p.sale_mode,
               p.cemetery_zone,p.cemetery_subzone,p.cemetery_row,p.grave_class,p.burial_capacity,p.orientation,
               p.source_status,p.source_sheet,p.source_row,p.inventory_source,p.notes,p.updated_at
        FROM public.properties p
        WHERE p.project='Thiên Phúc Vĩnh Hằng Viên'
          AND (p.id=nullif(p_payload->>'id','')::uuid OR p.code=nullif(p_payload->>'code',''))
        LIMIT 1
      ) q));

  ELSIF p_action='update_plot' THEN
    IF cu.role NOT IN ('ceo','admin','manager') THEN RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền cập nhật giỏ mộ phần'); END IF;
    v_id:=nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Thiếu ID mộ phần'); END IF;
    v_status:=coalesce(nullif(p_payload->>'sales_status',''),(SELECT sales_status FROM public.properties WHERE id=v_id));
    IF v_status NOT IN ('available','deposit','locked') THEN RETURN jsonb_build_object('ok',false,'error','Trạng thái không hợp lệ'); END IF;
    UPDATE public.properties SET
      price_before_vat=coalesce(nullif(p_payload->>'price_before_vat','')::numeric,price_before_vat),
      price=coalesce(nullif(p_payload->>'price_before_vat','')::numeric,price),
      sales_status=v_status,
      source_status=CASE v_status WHEN 'available' THEN 'Mở bán' WHEN 'deposit' THEN 'Đặt cọc' ELSE 'Khóa' END,
      status=CASE v_status WHEN 'available' THEN 'available' WHEN 'deposit' THEN 'reserved' ELSE 'locked' END,
      sale_mode=CASE WHEN p_payload ? 'sale_mode' THEN nullif(p_payload->>'sale_mode','') ELSE sale_mode END,
      notes=CASE WHEN p_payload ? 'notes' THEN nullif(p_payload->>'notes','') ELSE notes END,
      inventory_updated_at=now(),updated_at=now()
    WHERE id=v_id AND project='Thiên Phúc Vĩnh Hằng Viên';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy mộ phần'); END IF;
    INSERT INTO public.activity_log(user_id,action,entity_type,entity_id,detail) VALUES(cu.id,'cemetery.plot.update','property',v_id,jsonb_build_object('sales_status',v_status,'price_before_vat',p_payload->>'price_before_vat'));
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSE
    RETURN jsonb_build_object('ok',false,'error','Thao tác giỏ mộ phần không hợp lệ');
  END IF;
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
END
$function$
;

REVOKE ALL ON FUNCTION public.crm_cemetery_api(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_cemetery_api(text,text,jsonb) TO anonymous;
NOTIFY pgrst,'reload schema';
