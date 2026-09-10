from django.db import models


class TaskStatus(models.TextChoices):
    TODO = "todo", "To do"
    DOING = "doing", "Doing"
    DONE = "done", "Done"


class CaseTask(models.Model):
    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    assignee = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="assigned_tasks")
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="created_tasks")
    status = models.CharField(max_length=16, choices=TaskStatus.choices, default=TaskStatus.TODO)
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)


class CaseComment(models.Model):
    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at",)


class CaseLink(models.Model):
    """Formal bidirectional link between two cases (confirmed cross-case connection)."""

    from_case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="links_from")
    to_case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="links_to")
    reason = models.CharField(max_length=512, blank=True, default="")
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["from_case", "to_case"], name="uniq_case_link"),
        ]
