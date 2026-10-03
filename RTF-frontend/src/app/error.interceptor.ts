import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { catchError, throwError } from "rxjs";

export const errorInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const message = error.error?.message ?? (error.status === 0
        ? "The service is unreachable. Check your connection and try again."
        : "The request could not be completed.");
      return throwError(() => new Error(message));
    })
  );
