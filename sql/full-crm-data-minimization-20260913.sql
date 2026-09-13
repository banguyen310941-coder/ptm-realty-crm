CREATE OR REPLACE FUNCTION public.crm_full_api_internal(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_id uuid;
  v_lead uuid;
  v_owner uuid;
  v_result jsonb;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  END IF;

  IF p_action='bootstrap' THEN
    SELECT jsonb_build_object(
      'ok',true,
      'lead_meta',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'customer_code',l.customer_code,'score',l.score,'last_contact_at',l.last_contact_at,'next_follow_up_at',l.next_follow_up_at,'profile',l.profile)) FROM public.leads l WHERE v_role<>'sale' OR l.owner_id=v_uid),'[]'::jsonb),
      'tags',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM public.crm_tags t),'[]'::jsonb),
      'lead_tags',coalesce((SELECT jsonb_agg(jsonb_build_object('lead_id',lt.lead_id,'tag_id',lt.tag_id)) FROM public.crm_lead_tags lt JOIN public.leads l ON l.id=lt.lead_id WHERE v_role<>'sale' OR l.owner_id=v_uid),'[]'::jsonb),
      'activities',coalesce((SELECT jsonb_agg(x ORDER BY (x->>'happened_at')::timestamptz DESC) FROM (
        SELECT jsonb_build_object('id',a.id,'lead_id',a.lead_id,'lead_name',l.name,'user_id',a.user_id,'user_name',u.name,'activity_type',a.activity_type,'subject',a.subject,'content',a.content,'outcome',a.outcome,'happened_at',a.happened_at,'next_action_at',a.next_action_at,'attachments',a.attachments) x
        FROM public.crm_activities a JOIN public.leads l ON l.id=a.lead_id LEFT JOIN public.users u ON u.id=a.user_id
        WHERE v_role<>'sale' OR l.owner_id=v_uid OR a.user_id=v_uid
        ORDER BY a.happened_at DESC LIMIT 500
      ) q),'[]'::jsonb),
      'opportunities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'lead_id',o.lead_id,'lead_name',l.name,'property_id',o.property_id,'property_name',p.name,'owner_id',o.owner_id,'owner_name',u.name,'stage',o.stage,'status',o.status,'value',CASE WHEN v_role='marketing' THEN NULL ELSE o.value END,'probability',o.probability,'expected_close_date',o.expected_close_date,'lost_reason',o.lost_reason,'notes',o.notes,'created_at',o.created_at,'updated_at',o.updated_at) ORDER BY o.updated_at DESC)
        FROM public.crm_opportunities o LEFT JOIN public.leads l ON l.id=o.lead_id LEFT JOIN public.properties p ON p.id=o.property_id LEFT JOIN public.users u ON u.id=o.owner_id
        WHERE v_role<>'sale' OR o.owner_id=v_uid),'[]'::jsonb),
      'campaigns',CASE WHEN v_role IN ('admin','ceo','manager','marketing') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'campaign_type',c.campaign_type,'channel',c.channel,'status',c.status,'budget',CASE WHEN v_role='marketing' OR v_role IN ('admin','ceo','manager') THEN c.budget ELSE NULL END,'start_date',c.start_date,'end_date',c.end_date,'utm_source',c.utm_source,'utm_medium',c.utm_medium,'utm_campaign',c.utm_campaign,'target_leads',c.target_leads,'owner_id',c.owner_id,'owner_name',u.name,'member_count',(SELECT count(*) FROM public.crm_campaign_members cm WHERE cm.campaign_id=c.id),'converted_count',(SELECT count(*) FROM public.crm_campaign_members cm WHERE cm.campaign_id=c.id AND cm.member_status='converted'),'notes',c.notes) ORDER BY c.created_at DESC)
        FROM public.crm_campaigns c LEFT JOIN public.users u ON u.id=c.owner_id),'[]'::jsonb) ELSE '[]'::jsonb END,
      'tickets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'lead_id',t.lead_id,'lead_name',l.name,'subject',t.subject,'category',t.category,'priority',t.priority,'status',t.status,'assigned_to',t.assigned_to,'assigned_name',u.name,'created_by',t.created_by,'description',t.description,'resolution',t.resolution,'sla_due_at',t.sla_due_at,'created_at',t.created_at,'updated_at',t.updated_at,'closed_at',t.closed_at) ORDER BY t.updated_at DESC)
        FROM public.crm_tickets t LEFT JOIN public.leads l ON l.id=t.lead_id LEFT JOIN public.users u ON u.id=t.assigned_to
        WHERE v_role IN ('admin','ceo','manager') OR t.assigned_to=v_uid OR t.created_by=v_uid OR (v_role='sale' AND l.owner_id=v_uid)),'[]'::jsonb),
      'kpis',coalesce((SELECT jsonb_agg(jsonb_build_object('id',k.id,'user_id',k.user_id,'user_name',u.name,'role_scope',k.role_scope,'period_month',k.period_month,'metric_key',k.metric_key,'target_value',k.target_value,'weight',k.weight) ORDER BY k.period_month DESC,u.name)
        FROM public.crm_kpi_targets k LEFT JOIN public.users u ON u.id=k.user_id
        WHERE v_role IN ('admin','ceo','manager') OR k.user_id=v_uid),'[]'::jsonb),
      'automations',CASE WHEN v_role IN ('admin','ceo','manager','marketing') THEN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.updated_at DESC) FROM public.crm_automation_rules r),'[]'::jsonb) ELSE '[]'::jsonb END,
      'notifications',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM (SELECT * FROM public.crm_notifications WHERE user_id=v_uid ORDER BY created_at DESC LIMIT 100) n),'[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF p_action='customer.update_meta' THEN
    v_lead := nullif(p_payload->>'lead_id','')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=v_lead AND (v_role IN ('admin','ceo','manager','marketing') OR (v_role='sale' AND l.owner_id=v_uid))) THEN
      RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền cập nhật khách hàng này.');
    END IF;
    UPDATE public.leads SET
      customer_code=coalesce(nullif(p_payload->>'customer_code',''),customer_code),
      score=coalesce(nullif(p_payload->>'score','')::integer,score),
      next_follow_up_at=CASE WHEN p_payload ? 'next_follow_up_at' THEN nullif(p_payload->>'next_follow_up_at','')::timestamptz ELSE next_follow_up_at END,
      profile=CASE WHEN p_payload ? 'profile' THEN coalesce(p_payload->'profile','{}'::jsonb) ELSE profile END,
      updated_at=now()
    WHERE id=v_lead;
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF p_action='tag.save' THEN
    IF v_role NOT IN ('admin','ceo','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền quản lý nhãn.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_tags(name,color,created_by) VALUES (p_payload->>'name',coalesce(nullif(p_payload->>'color',''),'#0f766e'),v_uid) RETURNING id INTO v_id;
    ELSE
      UPDATE public.crm_tags SET name=coalesce(nullif(p_payload->>'name',''),name),color=coalesce(nullif(p_payload->>'color',''),color) WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='tag.attach' THEN
    v_lead := nullif(p_payload->>'lead_id','')::uuid;
    v_id := nullif(p_payload->>'tag_id','')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=v_lead AND (v_role IN ('admin','ceo','manager','marketing') OR (v_role='sale' AND l.owner_id=v_uid))) THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền gắn nhãn khách hàng.'); END IF;
    IF coalesce((p_payload->>'remove')::boolean,false) THEN DELETE FROM public.crm_lead_tags WHERE lead_id=v_lead AND tag_id=v_id; ELSE INSERT INTO public.crm_lead_tags(lead_id,tag_id) VALUES(v_lead,v_id) ON CONFLICT DO NOTHING; END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF p_action='activity.create' THEN
    v_lead := nullif(p_payload->>'lead_id','')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=v_lead AND (v_role IN ('admin','ceo','manager','marketing') OR (v_role='sale' AND l.owner_id=v_uid))) THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền ghi tương tác cho khách hàng này.'); END IF;
    INSERT INTO public.crm_activities(lead_id,user_id,activity_type,subject,content,outcome,happened_at,next_action_at,attachments)
    VALUES(v_lead,v_uid,coalesce(nullif(p_payload->>'activity_type',''),'note'),p_payload->>'subject',p_payload->>'content',p_payload->>'outcome',coalesce(nullif(p_payload->>'happened_at','')::timestamptz,now()),nullif(p_payload->>'next_action_at','')::timestamptz,coalesce(p_payload->'attachments','[]'::jsonb)) RETURNING id INTO v_id;
    UPDATE public.leads SET last_contact_at=now(),next_follow_up_at=coalesce(nullif(p_payload->>'next_action_at','')::timestamptz,next_follow_up_at),updated_at=now() WHERE id=v_lead;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='opportunity.save' THEN
    IF v_role NOT IN ('admin','ceo','manager','sale') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền cập nhật cơ hội.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    v_owner := CASE WHEN v_role='sale' THEN v_uid ELSE coalesce(nullif(p_payload->>'owner_id','')::uuid,v_uid) END;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_opportunities(name,lead_id,property_id,owner_id,stage,status,value,probability,expected_close_date,lost_reason,notes)
      VALUES(p_payload->>'name',nullif(p_payload->>'lead_id','')::uuid,nullif(p_payload->>'property_id','')::uuid,v_owner,coalesce(nullif(p_payload->>'stage',''),'qualify'),coalesce(nullif(p_payload->>'status',''),'open'),coalesce(nullif(p_payload->>'value','')::numeric,0),coalesce(nullif(p_payload->>'probability','')::integer,10),nullif(p_payload->>'expected_close_date','')::date,p_payload->>'lost_reason',p_payload->>'notes') RETURNING id INTO v_id;
    ELSE
      IF v_role='sale' AND NOT EXISTS(SELECT 1 FROM public.crm_opportunities WHERE id=v_id AND owner_id=v_uid) THEN RETURN jsonb_build_object('ok',false,'error','Bạn chỉ được sửa cơ hội của mình.'); END IF;
      UPDATE public.crm_opportunities SET name=coalesce(nullif(p_payload->>'name',''),name),lead_id=CASE WHEN p_payload ? 'lead_id' THEN nullif(p_payload->>'lead_id','')::uuid ELSE lead_id END,property_id=CASE WHEN p_payload ? 'property_id' THEN nullif(p_payload->>'property_id','')::uuid ELSE property_id END,owner_id=v_owner,stage=coalesce(nullif(p_payload->>'stage',''),stage),status=coalesce(nullif(p_payload->>'status',''),status),value=coalesce(nullif(p_payload->>'value','')::numeric,value),probability=coalesce(nullif(p_payload->>'probability','')::integer,probability),expected_close_date=CASE WHEN p_payload ? 'expected_close_date' THEN nullif(p_payload->>'expected_close_date','')::date ELSE expected_close_date END,lost_reason=CASE WHEN p_payload ? 'lost_reason' THEN p_payload->>'lost_reason' ELSE lost_reason END,notes=CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,updated_at=now() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='campaign.save' THEN
    IF v_role NOT IN ('admin','ceo','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền quản lý chiến dịch.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_campaigns(name,campaign_type,channel,status,budget,start_date,end_date,utm_source,utm_medium,utm_campaign,target_leads,owner_id,notes)
      VALUES(p_payload->>'name',coalesce(nullif(p_payload->>'campaign_type',''),'digital'),coalesce(nullif(p_payload->>'channel',''),'other'),coalesce(nullif(p_payload->>'status',''),'draft'),coalesce(nullif(p_payload->>'budget','')::numeric,0),nullif(p_payload->>'start_date','')::date,nullif(p_payload->>'end_date','')::date,p_payload->>'utm_source',p_payload->>'utm_medium',p_payload->>'utm_campaign',coalesce(nullif(p_payload->>'target_leads','')::integer,0),v_uid,p_payload->>'notes') RETURNING id INTO v_id;
    ELSE
      UPDATE public.crm_campaigns SET name=coalesce(nullif(p_payload->>'name',''),name),campaign_type=coalesce(nullif(p_payload->>'campaign_type',''),campaign_type),channel=coalesce(nullif(p_payload->>'channel',''),channel),status=coalesce(nullif(p_payload->>'status',''),status),budget=coalesce(nullif(p_payload->>'budget','')::numeric,budget),start_date=CASE WHEN p_payload ? 'start_date' THEN nullif(p_payload->>'start_date','')::date ELSE start_date END,end_date=CASE WHEN p_payload ? 'end_date' THEN nullif(p_payload->>'end_date','')::date ELSE end_date END,utm_source=CASE WHEN p_payload ? 'utm_source' THEN p_payload->>'utm_source' ELSE utm_source END,utm_medium=CASE WHEN p_payload ? 'utm_medium' THEN p_payload->>'utm_medium' ELSE utm_medium END,utm_campaign=CASE WHEN p_payload ? 'utm_campaign' THEN p_payload->>'utm_campaign' ELSE utm_campaign END,target_leads=coalesce(nullif(p_payload->>'target_leads','')::integer,target_leads),notes=CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE notes END,updated_at=now() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='campaign.add_member' THEN
    IF v_role NOT IN ('admin','ceo','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền quản lý chiến dịch.'); END IF;
    INSERT INTO public.crm_campaign_members(campaign_id,lead_id,member_status,source_detail)
    VALUES((p_payload->>'campaign_id')::uuid,(p_payload->>'lead_id')::uuid,coalesce(nullif(p_payload->>'member_status',''),'new'),p_payload->>'source_detail')
    ON CONFLICT(campaign_id,lead_id) DO UPDATE SET member_status=excluded.member_status,source_detail=excluded.source_detail;
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF p_action='ticket.save' THEN
    IF v_role NOT IN ('admin','ceo','manager','sale','marketing') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền cập nhật ticket.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN
      v_owner := CASE WHEN v_role='sale' THEN v_uid ELSE coalesce(nullif(p_payload->>'assigned_to','')::uuid,v_uid) END;
      INSERT INTO public.crm_tickets(lead_id,subject,category,priority,status,assigned_to,created_by,description,sla_due_at)
      VALUES(nullif(p_payload->>'lead_id','')::uuid,p_payload->>'subject',coalesce(nullif(p_payload->>'category',''),'support'),coalesce(nullif(p_payload->>'priority',''),'normal'),coalesce(nullif(p_payload->>'status',''),'open'),v_owner,v_uid,p_payload->>'description',nullif(p_payload->>'sla_due_at','')::timestamptz) RETURNING id INTO v_id;
    ELSE
      IF v_role='sale' AND NOT EXISTS(SELECT 1 FROM public.crm_tickets t LEFT JOIN public.leads l ON l.id=t.lead_id WHERE t.id=v_id AND (t.assigned_to=v_uid OR t.created_by=v_uid OR l.owner_id=v_uid)) THEN RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền sửa ticket này.'); END IF;
      UPDATE public.crm_tickets SET subject=coalesce(nullif(p_payload->>'subject',''),subject),category=coalesce(nullif(p_payload->>'category',''),category),priority=coalesce(nullif(p_payload->>'priority',''),priority),status=coalesce(nullif(p_payload->>'status',''),status),assigned_to=CASE WHEN v_role='sale' THEN assigned_to WHEN p_payload ? 'assigned_to' THEN nullif(p_payload->>'assigned_to','')::uuid ELSE assigned_to END,description=CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,resolution=CASE WHEN p_payload ? 'resolution' THEN p_payload->>'resolution' ELSE resolution END,sla_due_at=CASE WHEN p_payload ? 'sla_due_at' THEN nullif(p_payload->>'sla_due_at','')::timestamptz ELSE sla_due_at END,closed_at=CASE WHEN coalesce(nullif(p_payload->>'status',''),status) IN ('resolved','closed') THEN coalesce(closed_at,now()) ELSE NULL END,updated_at=now() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='kpi.save' THEN
    IF v_role NOT IN ('admin','ceo','manager') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền thiết lập KPI.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_kpi_targets(user_id,role_scope,period_month,metric_key,target_value,weight,created_by)
      VALUES(nullif(p_payload->>'user_id','')::uuid,p_payload->>'role_scope',(date_trunc('month',coalesce(nullif(p_payload->>'period_month','')::date,current_date)))::date,p_payload->>'metric_key',coalesce(nullif(p_payload->>'target_value','')::numeric,0),coalesce(nullif(p_payload->>'weight','')::numeric,1),v_uid)
      ON CONFLICT(user_id,period_month,metric_key) DO UPDATE SET target_value=excluded.target_value,weight=excluded.weight,updated_at=now() RETURNING id INTO v_id;
    ELSE
      UPDATE public.crm_kpi_targets SET target_value=coalesce(nullif(p_payload->>'target_value','')::numeric,target_value),weight=coalesce(nullif(p_payload->>'weight','')::numeric,weight),updated_at=now() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='automation.save' THEN
    IF v_role NOT IN ('admin','ceo','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền quản lý automation.'); END IF;
    v_id := nullif(p_payload->>'id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_automation_rules(name,event_type,conditions,actions,enabled,created_by)
      VALUES(p_payload->>'name',p_payload->>'event_type',coalesce(p_payload->'conditions','{}'::jsonb),coalesce(p_payload->'actions','[]'::jsonb),coalesce((p_payload->>'enabled')::boolean,true),v_uid) RETURNING id INTO v_id;
    ELSE
      UPDATE public.crm_automation_rules SET name=coalesce(nullif(p_payload->>'name',''),name),event_type=coalesce(nullif(p_payload->>'event_type',''),event_type),conditions=CASE WHEN p_payload ? 'conditions' THEN p_payload->'conditions' ELSE conditions END,actions=CASE WHEN p_payload ? 'actions' THEN p_payload->'actions' ELSE actions END,enabled=coalesce((p_payload->>'enabled')::boolean,enabled),updated_at=now() WHERE id=v_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  END IF;

  IF p_action='notification.read' THEN
    UPDATE public.crm_notifications SET read_at=coalesce(read_at,now()) WHERE id=(p_payload->>'id')::uuid AND user_id=v_uid;
    RETURN jsonb_build_object('ok',true);
  END IF;

  RETURN jsonb_build_object('ok',false,'error','Hành động CRM mở rộng không hợp lệ.');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
END
$function$
;

REVOKE ALL ON FUNCTION public.crm_full_api_internal(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_full_api_internal(text,text,jsonb) TO anonymous;
NOTIFY pgrst,'reload schema';
