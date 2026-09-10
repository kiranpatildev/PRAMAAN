"""Case workflow (Phase 7): tasks, comments, formal case links, activity feed."""
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.auditlog.models import AuditLog

from .models import Case, CaseComment, CaseLink, CaseTask
from .permissions import user_can_edit_case, user_can_view_case


class CaseTaskSerializer(serializers.ModelSerializer):
    assignee_name = serializers.CharField(source="assignee.username", read_only=True, default="")
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")

    class Meta:
        model = CaseTask
        fields = ("id", "case", "title", "description", "assignee", "assignee_name",
                  "created_by", "created_by_name", "status", "due_date",
                  "created_at", "updated_at")
        read_only_fields = ("id", "case", "created_by", "created_at", "updated_at")


class CaseCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.username", read_only=True, default="")

    class Meta:
        model = CaseComment
        fields = ("id", "case", "author", "author_name", "text", "created_at")
        read_only_fields = ("id", "case", "author", "created_at")


class CaseLinkSerializer(serializers.ModelSerializer):
    from_fir = serializers.CharField(source="from_case.fir_no", read_only=True)
    to_fir = serializers.CharField(source="to_case.fir_no", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default="")

    class Meta:
        model = CaseLink
        fields = ("id", "from_case", "from_fir", "to_case", "to_fir", "reason",
                  "created_by", "created_by_name", "created_at")
        read_only_fields = ("id", "from_case", "created_by", "created_at")


def _case_or_403(request, case_pk):
    try:
        case = Case.objects.get(pk=case_pk)
    except Case.DoesNotExist:
        return None, Response({"detail": "Case not found."}, status=404)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def task_list_create(request, case_pk):
    from apps.accounts.models import User
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    if request.method == "GET":
        qs = CaseTask.objects.filter(case=case).select_related("assignee", "created_by")
        status_ = request.query_params.get("status")
        if status_:
            qs = qs.filter(status=status_)
        return Response(CaseTaskSerializer(qs[:100], many=True).data)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    assignee_id = request.data.get("assignee")
    assignee = None
    if assignee_id:
        try:
            assignee = User.objects.get(pk=int(assignee_id))
        except (User.DoesNotExist, ValueError):
            return Response({"detail": "Assignee not found."}, status=400)
        if not user_can_view_case(assignee, case):
            return Response({"detail": "Assignee cannot see this case."}, status=400)
    task = CaseTask.objects.create(
        case=case, title=(request.data.get("title") or "").strip()[:255],
        description=request.data.get("description", ""),
        assignee=assignee, created_by=request.user,
        status=request.data.get("status", "todo") if request.data.get("status") in ("todo", "doing", "done") else "todo",
        due_date=request.data.get("due_date") or None)
    if not task.title:
        task.delete()
        return Response({"detail": "title is required."}, status=400)
    return Response(CaseTaskSerializer(task).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def task_detail(request, case_pk, pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    task = get_object_or_404(CaseTask, pk=pk, case=case)
    if request.method == "DELETE":
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        task.delete()
        return Response(status=204)
    # PATCH: editors change anything; assignees may move their own status.
    if not (user_can_edit_case(request.user, case) or task.assignee_id == request.user.id):
        return Response({"detail": "Forbidden."}, status=403)
    allowed = {"status", "title", "description", "due_date"}
    if user_can_edit_case(request.user, case):
        allowed |= {"assignee"}
    for field in allowed:
        if field in request.data:
            if field == "assignee" and request.data[field] in (None, ""):
                task.assignee = None
            elif field == "status" and request.data[field] not in ("todo", "doing", "done"):
                return Response({"detail": "bad status."}, status=400)
            else:
                setattr(task, field, request.data[field] if field != "assignee" else task.assignee)
    if "assignee" in request.data and request.data["assignee"]:
        from apps.accounts.models import User
        try:
            task.assignee = User.objects.get(pk=int(request.data["assignee"]))
        except (User.DoesNotExist, ValueError):
            return Response({"detail": "Assignee not found."}, status=400)
    task.save()
    return Response(CaseTaskSerializer(task).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def comment_list_create(request, case_pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    if request.method == "GET":
        qs = (CaseComment.objects.filter(case=case).select_related("author")
              .order_by("-created_at")[:100])
        return Response(CaseCommentSerializer(qs, many=True).data)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    text = (request.data.get("text") or "").strip()
    if not text:
        return Response({"detail": "text is required."}, status=400)
    c = CaseComment.objects.create(case=case, author=request.user, text=text[:5000])
    return Response(CaseCommentSerializer(c).data, status=201)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def comment_delete(request, case_pk, pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    c = get_object_or_404(CaseComment, pk=pk, case=case)
    if not (c.author_id == request.user.id or request.user.is_sho()):
        return Response({"detail": "Forbidden."}, status=403)
    c.delete()
    return Response(status=204)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def link_list_create(request, case_pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    if request.method == "GET":
        qs = (CaseLink.objects.filter(Q(from_case=case) | Q(to_case=case))
              .select_related("from_case", "to_case", "created_by"))
        return Response(CaseLinkSerializer(qs[:100], many=True).data)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    try:
        target = Case.objects.get(pk=int(request.data.get("to_case")))
    except (Case.DoesNotExist, TypeError, ValueError):
        return Response({"detail": "to_case is required."}, status=400)
    if target.id == case.id:
        return Response({"detail": "Cannot link a case to itself."}, status=400)
    if not user_can_view_case(request.user, target):
        return Response({"detail": "Forbidden for target case."}, status=403)
    if CaseLink.objects.filter(Q(from_case=case, to_case=target) | Q(from_case=target, to_case=case)).exists():
        return Response({"detail": "Cases already linked."}, status=409)
    link = CaseLink.objects.create(from_case=case, to_case=target,
                                   reason=(request.data.get("reason") or "")[:512],
                                   created_by=request.user)
    return Response(CaseLinkSerializer(link).data, status=201)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def link_delete(request, case_pk, pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    link = get_object_or_404(CaseLink, pk=pk)
    if link.from_case_id != case.id and link.to_case_id != case.id:
        return Response({"detail": "Not found."}, status=404)
    if not (user_can_edit_case(request.user, link.from_case) or request.user.is_sho()):
        return Response({"detail": "Forbidden."}, status=403)
    link.delete()
    return Response(status=204)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def activity_feed(request, case_pk):
    """Unified feed: audit trail (mutating API calls) + tasks + comments."""
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    feed = []
    audits = (AuditLog.objects.filter(object_type__contains=f"/api/cases/{case.id}/")
              .select_related("actor").order_by("-timestamp")[:50])
    for a in audits:
        feed.append({"ts": a.timestamp, "kind": f"audit:{a.action}",
                     "actor": str(a.actor or "system"), "text": f"{a.action} {a.object_type}"})
    for t in CaseTask.objects.filter(case=case).select_related("assignee")[:20]:
        feed.append({"ts": t.updated_at, "kind": f"task:{t.status}",
                     "actor": str(t.assignee or "unassigned"), "text": t.title})
    for c in CaseComment.objects.filter(case=case).select_related("author")[:20]:
        feed.append({"ts": c.created_at, "kind": "comment",
                     "actor": str(c.author or "?"), "text": c.text[:160]})
    feed.sort(key=lambda e: e["ts"], reverse=True)
    return Response({"case_id": case.id, "activity": feed[:50]})
